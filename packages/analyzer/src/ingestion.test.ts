import { describe, expect, it, vi } from 'vitest';
import { analyzeRepository, defaultParserRegistry } from './index.js';
import path from 'node:path';
import fs from 'node:fs';

describe('analyzer ingestion error boundary', () => {
  it('completes analysis successfully when an individual file crashes ts-morph AST extraction', () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'ingestion-test-'));
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Valid file A that imports helper
    const fileA = path.join(srcDir, 'moduleA.ts');
    // Valid helper file
    const fileHelper = path.join(srcDir, 'helper.ts');
    // Malformed / crashing file
    const fileCrashing = path.join(srcDir, 'crashing.ts');

    fs.writeFileSync(fileHelper, 'export const helper = 1;');
    fs.writeFileSync(fileA, 'import { helper } from "./helper";\nexport const a = helper + 1;');
    fs.writeFileSync(fileCrashing, 'const malformed = ;');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Spy on defaultParserRegistry.extractDependencies to simulate compiler failure
    const origExtract = defaultParserRegistry.extractDependencies;
    const addSpy = vi.spyOn(defaultParserRegistry, 'extractDependencies').mockImplementation(function (this: any, repoRoot: string, filePath: string) {
      if (filePath.replace(/\\/g, '/').includes('crashing.ts')) {
        throw new Error('Debug Failure. False expression.\nat @ts-morph/common/dist/typescript.js\nparseVariableDeclarationList');
      }
      return origExtract.call(this, repoRoot, filePath);
    });

    // Run analysis on the repository
    const result = analyzeRepository({ repositoryPath: tempDir });

    addSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });

    // 1. Analysis must complete successfully without throwing
    expect(result).toBeDefined();
    expect(result.summary).toBeDefined();

    // 2. All files are still detected and present in result.files
    const filePaths = result.files.map(f => f.path);
    expect(filePaths).toContain('src/moduleA.ts');
    expect(filePaths).toContain('src/helper.ts');
    expect(filePaths).toContain('src/crashing.ts');

    // 3. Crashing file has empty dependencies (no fake dependencies invented)
    const crashingFile = result.files.find(f => f.path === 'src/crashing.ts');
    expect(crashingFile).toBeDefined();
    expect(crashingFile?.dependencyCount).toBe(0);

    const crashingDepRecord = result.dependencies.find(d => d.source === 'src/crashing.ts');
    expect(crashingDepRecord).toBeDefined();
    expect(crashingDepRecord?.dependencies).toEqual([]);

    // 4. Other files are still analyzed and their dependencies are intact
    const moduleAFile = result.files.find(f => f.path === 'src/moduleA.ts');
    expect(moduleAFile).toBeDefined();
    expect(moduleAFile?.dependencyCount).toBe(1);

    const moduleADepRecord = result.dependencies.find(d => d.source === 'src/moduleA.ts');
    expect(moduleADepRecord).toBeDefined();
    expect(moduleADepRecord?.dependencies).toContain('src/helper.ts');

    // Helper file has moduleA as a dependent
    const helperFile = result.files.find(f => f.path === 'src/helper.ts');
    expect(helperFile?.dependentCount).toBe(1);

    // 5. Useful logging was emitted
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[Parser\] Skipping src\/crashing\.ts: Debug Failure\. False expression\./)
    );

    warnSpy.mockRestore();
  });

  it('excludes test fixtures and baselines from AST parsing while keeping them in repository analysis', () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'ingestion-exclude-test-'));
    const srcDir = path.join(tempDir, 'src');
    const testdataDir = path.join(tempDir, 'tsc/testdata');
    const testsDir = path.join(tempDir, 'tests/cases');

    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(testdataDir, { recursive: true });
    fs.mkdirSync(testsDir, { recursive: true });

    const fileIndex = path.join(srcDir, 'index.ts');
    const fileUtils = path.join(srcDir, 'utils.ts');
    const fileTestdata = path.join(testdataDir, 'heavyFixture.ts');
    const fileTestcase = path.join(testsDir, 'spec.ts');

    fs.writeFileSync(fileUtils, 'export const format = () => "formatted";');
    fs.writeFileSync(fileIndex, 'import { format } from "./utils";\nexport const main = format();');
    fs.writeFileSync(fileTestdata, 'export const huge = 999;');
    fs.writeFileSync(fileTestcase, 'import "./heavyFixture";');

    const origExtract = defaultParserRegistry.extractDependencies;
    const addedPaths: string[] = [];
    const addSpy = vi.spyOn(defaultParserRegistry, 'extractDependencies').mockImplementation(function (this: any, repoRoot: string, filePath: string) {
      addedPaths.push(filePath.replace(/\\/g, '/'));
      return origExtract.call(this, repoRoot, filePath);
    });

    const result = analyzeRepository({ repositoryPath: tempDir });

    addSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });

    // 1. Analysis finishes successfully
    expect(result).toBeDefined();

    // 2. All files are present in the analysis
    const filePaths = result.files.map(f => f.path);
    expect(filePaths).toContain('src/index.ts');
    expect(filePaths).toContain('src/utils.ts');
    expect(filePaths).toContain('tsc/testdata/heavyFixture.ts');
    expect(filePaths).toContain('tests/cases/spec.ts');

    // 3. Normal source files are added to ts-morph and dependencies are parsed
    expect(addedPaths.some(p => p.includes('src/index.ts'))).toBe(true);
    expect(addedPaths.some(p => p.includes('src/utils.ts'))).toBe(true);
    const indexFile = result.files.find(f => f.path === 'src/index.ts');
    expect(indexFile?.dependencyCount).toBe(1);

    // 4. Test fixture / baseline files are NOT added to ts-morph (avoids OOM on huge repos)
    expect(addedPaths.some(p => p.includes('tsc/testdata'))).toBe(false);
    expect(addedPaths.some(p => p.includes('tests/cases'))).toBe(false);

    const testdataFile = result.files.find(f => f.path === 'tsc/testdata/heavyFixture.ts');
    expect(testdataFile?.dependencyCount).toBe(0);

    const testcaseFile = result.files.find(f => f.path === 'tests/cases/spec.ts');
    expect(testcaseFile?.dependencyCount).toBe(0);
  });

  it('processes a large repository with 150+ source files within bounded memory and completes successfully', () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'ingestion-large-repo-test-'));
    const coreDir = path.join(tempDir, 'src/core');
    const featuresDir = path.join(tempDir, 'src/features');
    const uiDir = path.join(tempDir, 'src/ui');

    fs.mkdirSync(coreDir, { recursive: true });
    fs.mkdirSync(featuresDir, { recursive: true });
    fs.mkdirSync(uiDir, { recursive: true });

    const totalCount = 150;
    // Generate files:
    // 0..49 in core
    // 50..99 in features (each importing corresponding core module)
    // 100..149 in ui (each importing corresponding feature module)
    for (let i = 0; i < 50; i++) {
      const prevImport = i > 0 ? `import { fn_${i - 1} } from "./mod_${i - 1}";\n` : '';
      const prevCall = i > 0 ? `fn_${i - 1}() + ` : '';
      fs.writeFileSync(
        path.join(coreDir, `mod_${i}.ts`),
        `${prevImport}export const fn_${i} = () => ${prevCall}${i};\nexport const val_${i} = ${i};`
      );
    }

    for (let i = 50; i < 100; i++) {
      const coreIdx = i - 50;
      fs.writeFileSync(
        path.join(featuresDir, `mod_${i}.ts`),
        `import { fn_${coreIdx} } from "../core/mod_${coreIdx}";\nexport const feature_${i} = () => fn_${coreIdx}() * 2;`
      );
    }

    for (let i = 100; i < 150; i++) {
      const featIdx = i - 50;
      fs.writeFileSync(
        path.join(uiDir, `mod_${i}.tsx`),
        `import { feature_${featIdx} } from "../features/mod_${featIdx}";\nexport const View_${i} = () => "View: " + feature_${featIdx}();`
      );
    }

    const memBefore = process.memoryUsage().heapUsed;
    const result = analyzeRepository({ repositoryPath: tempDir });
    const memAfter = process.memoryUsage().heapUsed;

    fs.rmSync(tempDir, { recursive: true, force: true });

    // 1. All 150 files detected and analyzed
    expect(result).toBeDefined();
    expect(result.files.length).toBe(totalCount);
    expect(result.summary.filesAnalyzed).toBe(totalCount);

    // 2. Dependencies properly extracted
    const sampleUi = result.files.find(f => f.path === 'src/ui/mod_125.tsx');
    expect(sampleUi).toBeDefined();
    expect(sampleUi?.dependencyCount).toBe(1);

    const sampleUiDep = result.dependencies.find(d => d.source === 'src/ui/mod_125.tsx');
    expect(sampleUiDep?.dependencies).toContain('src/features/mod_75.ts');

    const sampleCore = result.files.find(f => f.path === 'src/core/mod_25.ts');
    expect(sampleCore).toBeDefined();
    expect(sampleCore?.dependencyCount).toBe(1);

    // 3. Memory remains bounded (heap delta should be well under 100MB for per-file parsing)
    const heapDeltaMB = Math.round((memAfter - memBefore) / 1024 / 1024);
    expect(heapDeltaMB).toBeLessThan(100);
  });
});

