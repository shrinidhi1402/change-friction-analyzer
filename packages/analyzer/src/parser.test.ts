import { describe, expect, it } from 'vitest';
import { extractImports, buildDependencyGraph, getParserDiagnostics, clearParserDiagnostics, shouldParseForAst, defaultParserRegistry } from './parser.js';
import { getTreeDeletionsCount, resetTreeDeletionsCount } from './parsers/index.js';
import { Project } from 'ts-morph';
import path from 'node:path';
import fs from 'node:fs';
import { vi } from 'vitest';

describe('parser', () => {
  describe('extractImports', () => {
    it('can accept an existing ts-morph project', () => {
      const project = new Project({ useInMemoryFileSystem: true });
      project.createSourceFile('src/a.ts', 'import { b } from "./b.ts";');
      project.createSourceFile('src/b.ts', 'export const b = 1;');

      const imports = extractImports('src', 'src/a.ts', project);
      expect(imports).toBeInstanceOf(Array);
      // Depending on the internals of resolveLocalImport which relies on real fs for some checks,
      // it might not perfectly resolve in memory without mocking fs.
      // The key is it doesn't throw and uses the project.
    });

    it('extracts CommonJS and ES module local dependencies while ignoring externals', () => {
      const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'parser-test-'));
      const srcDir = path.join(tempDir, 'src');
      const libDir = path.join(tempDir, 'lib');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(libDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, 'combined.js'), `
        import { something } from './es-module';
        const utils = require("./utils");
        const x = require("../lib/x");
        require("express"); // External, should be ignored
        require("fs"); // Built-in, should be ignored
      `);
      fs.writeFileSync(path.join(srcDir, 'es-module.js'), 'export const something = 1;');
      fs.writeFileSync(path.join(srcDir, 'utils.js'), 'module.exports = {};');
      fs.writeFileSync(path.join(libDir, 'x.js'), 'module.exports = {};');

      const project = new Project({ compilerOptions: { allowJs: true } });
      const deps = extractImports(tempDir, 'src/combined.js', project);
      
      fs.rmSync(tempDir, { recursive: true, force: true });

      expect(deps.some(d => d.endsWith('src/es-module.js'))).toBe(true); // ES module local import
      expect(deps.some(d => d.endsWith('src/utils.js'))).toBe(true); // CommonJS local require
      expect(deps.some(d => d.endsWith('lib/x.js'))).toBe(true); // relative require with ../
      expect(deps.some(d => d.includes('express'))).toBe(false); // external require
      expect(deps.some(d => d.includes('fs'))).toBe(false); // external require
      expect(deps.length).toBe(3); // a file containing both import and require
    });
  });

  describe('buildDependencyGraph', () => {
    it('builds a graph for multiple files', () => {
      const files = ['src/a.ts', 'src/b.ts'];
      // The actual buildDependencyGraph requires real fs to resolve local imports,
      // but we can verify it doesn't crash and returns a map.
      const graph = buildDependencyGraph('src', files);
      expect(graph).toBeInstanceOf(Map);
      expect(graph.has('src/a.ts')).toBe(true);
      expect(graph.has('src/b.ts')).toBe(true);
    });

    it('handles Windows-style path normalization correctly', () => {
      // Mock path.resolve to return Windows backslashes
      const resolveSpy = vi.spyOn(path, 'resolve').mockImplementation((...args) => {
        return path.posix.resolve(...args).replace(/\//g, '\\');
      });
      const readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
        return [{ name: 'b.ts', isDirectory: () => false, isFile: () => true } as any];
      });

      const files = ['src/a.ts', 'src/b.ts'];
      const graph = buildDependencyGraph('root', files);
      
      resolveSpy.mockRestore();
      readdirSpy.mockRestore();
      
      expect(graph).toBeInstanceOf(Map);
      expect(graph.has('src/a.ts')).toBe(true);
      expect(graph.has('src/b.ts')).toBe(true);
    });

    it('skips AST extraction for a file that causes parser/compiler exception and continues analyzing other files', () => {
      clearParserDiagnostics();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'parser-err-test-'));
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const fileValid = path.join(srcDir, 'valid.ts');
      const fileDep = path.join(srcDir, 'dep.ts');
      const fileBad = path.join(srcDir, 'bad.ts');

      fs.writeFileSync(fileDep, 'export const value = 42;');
      fs.writeFileSync(fileValid, 'import { value } from "./dep";');
      fs.writeFileSync(fileBad, 'const malformed = ;');

      // Mock defaultParserRegistry.extractDependencies to simulate parser crashing on bad.ts
      const origExtract = defaultParserRegistry.extractDependencies;
      const addSpy = vi.spyOn(defaultParserRegistry, 'extractDependencies').mockImplementation(function (this: any, repoRoot: string, filePath: string) {
        if (filePath.replace(/\\/g, '/').includes('bad.ts')) {
          throw new Error('Debug Failure. False expression.');
        }
        return origExtract.call(this, repoRoot, filePath);
      });

      const files = [
        path.relative(tempDir, fileValid).replace(/\\/g, '/'),
        path.relative(tempDir, fileDep).replace(/\\/g, '/'),
        path.relative(tempDir, fileBad).replace(/\\/g, '/'),
      ];

      const graph = buildDependencyGraph(tempDir, files);

      addSpy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });

      // The graph should contain all files
      expect(graph.has('src/valid.ts')).toBe(true);
      expect(graph.has('src/dep.ts')).toBe(true);
      expect(graph.has('src/bad.ts')).toBe(true);

      // bad.ts should have empty dependencies (no fake data invented)
      expect(graph.get('src/bad.ts')).toEqual([]);

      // valid.ts should still have successfully extracted its dependency
      const validDeps = graph.get('src/valid.ts') ?? [];
      expect(validDeps.some(d => d.endsWith('src/dep.ts'))).toBe(true);

      // Useful logging should be triggered: [Parser] Skipping <relative-path>: <error message>
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[Parser\] Skipping src\/bad\.ts: Debug Failure\. False expression\./)
      );

      // Diagnostics should record the skipped file and error
      const diagnostics = getParserDiagnostics();
      expect(diagnostics.some(d => d.filePath === 'src/bad.ts' && d.error.includes('Debug Failure'))).toBe(true);

      warnSpy.mockRestore();
    });

    it('extractImports handles AST extraction exceptions gracefully and returns empty array', () => {
      clearParserDiagnostics();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'parser-extract-err-'));
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const fileCrash = path.join(srcDir, 'crash.ts');
      fs.writeFileSync(fileCrash, 'export const a = 1;');

      const origExtract = defaultParserRegistry.extractDependencies;
      const addSpy = vi.spyOn(defaultParserRegistry, 'extractDependencies').mockImplementation(function (this: any, repoRoot: string, filePath: string) {
        if (filePath.replace(/\\/g, '/').includes('crash.ts')) {
          throw new Error('Debug Failure. False expression.');
        }
        return origExtract.call(this, repoRoot, filePath);
      });

      const deps = extractImports(tempDir, 'src/crash.ts');

      addSpy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });

      expect(deps).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[Parser\] Skipping src\/crash\.ts: Debug Failure\. False expression\./)
      );

      warnSpy.mockRestore();
    });

    it('does not add excluded test, testdata, fixture, or snapshot paths to ts-morph project', () => {
      const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'parser-exclude-test-'));
      const srcDir = path.join(tempDir, 'src');
      const testdataDir = path.join(tempDir, 'tsc/testdata');
      const testsDir = path.join(tempDir, 'tests/cases');
      const fixturesDir = path.join(tempDir, 'src/fixtures');
      const snapshotsDir = path.join(tempDir, 'snapshots');

      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(testdataDir, { recursive: true });
      fs.mkdirSync(testsDir, { recursive: true });
      fs.mkdirSync(fixturesDir, { recursive: true });
      fs.mkdirSync(snapshotsDir, { recursive: true });

      const fileSrc = path.join(srcDir, 'app.ts');
      const fileDep = path.join(srcDir, 'dep.ts');
      const fileTestdata = path.join(testdataDir, 'heavy.ts');
      const fileTests = path.join(testsDir, 'case1.ts');
      const fileFixture = path.join(fixturesDir, 'mock.ts');
      const fileSnapshot = path.join(snapshotsDir, 'view.ts');

      fs.writeFileSync(fileDep, 'export const dep = 1;');
      fs.writeFileSync(fileSrc, 'import { dep } from "./dep";');
      fs.writeFileSync(fileTestdata, 'export const huge = 1;');
      fs.writeFileSync(fileTests, 'import "./case1";');
      fs.writeFileSync(fileFixture, 'export const mock = 1;');
      fs.writeFileSync(fileSnapshot, 'export const snap = 1;');

      const origExtract = defaultParserRegistry.extractDependencies;
      const addedPaths: string[] = [];
      const addSpy = vi.spyOn(defaultParserRegistry, 'extractDependencies').mockImplementation(function (this: any, repoRoot: string, filePath: string) {
        addedPaths.push(filePath.replace(/\\/g, '/'));
        return origExtract.call(this, repoRoot, filePath);
      });

      const files = [
        path.relative(tempDir, fileSrc).replace(/\\/g, '/'),
        path.relative(tempDir, fileDep).replace(/\\/g, '/'),
        path.relative(tempDir, fileTestdata).replace(/\\/g, '/'),
        path.relative(tempDir, fileTests).replace(/\\/g, '/'),
        path.relative(tempDir, fileFixture).replace(/\\/g, '/'),
        path.relative(tempDir, fileSnapshot).replace(/\\/g, '/'),
      ];

      const graph = buildDependencyGraph(tempDir, files);

      addSpy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });

      // Normal files ARE parsed
      expect(addedPaths.some(p => p.includes('src/app.ts'))).toBe(true);
      expect(addedPaths.some(p => p.includes('src/dep.ts'))).toBe(true);
      const appDeps = graph.get('src/app.ts') ?? [];
      expect(appDeps.some(d => d.endsWith('src/dep.ts'))).toBe(true);

      // Excluded paths are NEVER parsed (memory saved)
      expect(addedPaths.some(p => p.includes('tsc/testdata'))).toBe(false);
      expect(addedPaths.some(p => p.includes('tests/cases'))).toBe(false);
      expect(addedPaths.some(p => p.includes('src/fixtures'))).toBe(false);
      expect(addedPaths.some(p => p.includes('snapshots'))).toBe(false);

      // Excluded files are in graph with empty dependencies
      expect(graph.get('tsc/testdata/heavy.ts')).toEqual([]);
      expect(graph.get('tests/cases/case1.ts')).toEqual([]);
      expect(graph.get('src/fixtures/mock.ts')).toEqual([]);
      expect(graph.get('snapshots/view.ts')).toEqual([]);
    });

    it('analyzes multiple files independently and releases AST SourceFile objects between files', () => {
      const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'parser-indep-test-'));
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const fileA = path.join(srcDir, 'a.ts');
      const fileB = path.join(srcDir, 'b.ts');
      const fileC = path.join(srcDir, 'c.ts');

      fs.writeFileSync(fileC, 'export const c = 3;');
      fs.writeFileSync(fileB, 'import { c } from "./c";\nexport const b = c + 1;');
      fs.writeFileSync(fileA, 'import { b } from "./b";\nexport const a = b + 1;');

      resetTreeDeletionsCount();

      const files = [
        path.relative(tempDir, fileA).replace(/\\/g, '/'),
        path.relative(tempDir, fileB).replace(/\\/g, '/'),
        path.relative(tempDir, fileC).replace(/\\/g, '/'),
      ];

      const graph = buildDependencyGraph(tempDir, files);
      fs.rmSync(tempDir, { recursive: true, force: true });

      // Verify that Tree-sitter deallocations occurred sequentially for each file
      expect(getTreeDeletionsCount()).toBe(3);

      // Verify dependencies are accurately extracted
      const aDeps = graph.get('src/a.ts') ?? [];
      const bDeps = graph.get('src/b.ts') ?? [];
      const cDeps = graph.get('src/c.ts') ?? [];

      expect(aDeps.some(d => d.endsWith('src/b.ts'))).toBe(true);
      expect(bDeps.some(d => d.endsWith('src/c.ts'))).toBe(true);
      expect(cDeps).toEqual([]);
    });

    it('correctly resolves local relative imports across .js, .jsx, .ts, and .tsx', () => {
      const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'parser-extensions-test-'));
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(path.join(srcDir, 'ui'), { recursive: true });

      const fileApp = path.join(srcDir, 'App.tsx');
      const fileCard = path.join(srcDir, 'ui/Card.jsx');
      const fileUtils = path.join(srcDir, 'utils.ts');
      const fileLegacy = path.join(srcDir, 'legacy.js');

      fs.writeFileSync(fileLegacy, 'module.exports = { legacyFlag: true };');
      fs.writeFileSync(fileUtils, 'const legacy = require("./legacy");\nexport const getFlag = () => legacy.legacyFlag;');
      fs.writeFileSync(fileCard, 'import { getFlag } from "../utils";\nexport const Card = () => "Card " + getFlag();');
      fs.writeFileSync(fileApp, 'import { Card } from "./ui/Card";\nexport const App = () => Card();');

      const files = [
        path.relative(tempDir, fileApp).replace(/\\/g, '/'),
        path.relative(tempDir, fileCard).replace(/\\/g, '/'),
        path.relative(tempDir, fileUtils).replace(/\\/g, '/'),
        path.relative(tempDir, fileLegacy).replace(/\\/g, '/'),
      ];

      const graph = buildDependencyGraph(tempDir, files);
      fs.rmSync(tempDir, { recursive: true, force: true });

      // App.tsx -> ui/Card.jsx
      const appDeps = graph.get('src/App.tsx') ?? [];
      expect(appDeps.some(d => d.endsWith('src/ui/Card.jsx'))).toBe(true);

      // ui/Card.jsx -> utils.ts (relative ../ resolution)
      const cardDeps = graph.get('src/ui/Card.jsx') ?? [];
      expect(cardDeps.some(d => d.endsWith('src/utils.ts'))).toBe(true);

      // utils.ts -> legacy.js (CommonJS require resolution)
      const utilDeps = graph.get('src/utils.ts') ?? [];
      expect(utilDeps.some(d => d.endsWith('src/legacy.js'))).toBe(true);

      // legacy.js -> no dependencies
      const legacyDeps = graph.get('src/legacy.js') ?? [];
      expect(legacyDeps).toEqual([]);
    });

    it('matches semantics on representative fixtures including cyclic imports, index resolution, and export declarations', () => {
      const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'parser-semantics-test-'));
      const srcDir = path.join(tempDir, 'src');
      const serviceDir = path.join(srcDir, 'service');
      const buttonDir = path.join(srcDir, 'components/button');

      fs.mkdirSync(serviceDir, { recursive: true });
      fs.mkdirSync(buttonDir, { recursive: true });

      const cycleA = path.join(srcDir, 'cycleA.ts');
      const cycleB = path.join(srcDir, 'cycleB.ts');
      const btnIndex = path.join(buttonDir, 'index.ts');
      const btnComponent = path.join(buttonDir, 'Button.tsx');
      const client = path.join(serviceDir, 'client.ts');

      // Cyclic import
      fs.writeFileSync(cycleA, 'import { b } from "./cycleB"; export const a = 1;');
      fs.writeFileSync(cycleB, 'import { a } from "./cycleA"; export const b = 2;');

      // Index export / resolution
      fs.writeFileSync(btnComponent, 'export const Button = () => "button";');
      fs.writeFileSync(btnIndex, 'export * from "./Button";\nexport { Button } from "./Button";');

      // Directory import resolving to index.ts
      fs.writeFileSync(client, 'import { Button } from "../components/button";\nexport const render = () => Button();');

      const files = [
        path.relative(tempDir, cycleA).replace(/\\/g, '/'),
        path.relative(tempDir, cycleB).replace(/\\/g, '/'),
        path.relative(tempDir, btnIndex).replace(/\\/g, '/'),
        path.relative(tempDir, btnComponent).replace(/\\/g, '/'),
        path.relative(tempDir, client).replace(/\\/g, '/'),
      ];

      const graph = buildDependencyGraph(tempDir, files);
      fs.rmSync(tempDir, { recursive: true, force: true });

      // Cycles are supported without infinite loops
      const aDeps = graph.get('src/cycleA.ts') ?? [];
      const bDeps = graph.get('src/cycleB.ts') ?? [];
      expect(aDeps.some(d => d.endsWith('src/cycleB.ts'))).toBe(true);
      expect(bDeps.some(d => d.endsWith('src/cycleA.ts'))).toBe(true);

      // export * and export { ... } from './Button' extracted from index.ts
      const indexDeps = graph.get('src/components/button/index.ts') ?? [];
      expect(indexDeps.some(d => d.endsWith('src/components/button/Button.tsx'))).toBe(true);

      // directory import '../components/button' resolves to '../components/button/index.ts'
      const clientDeps = graph.get('src/service/client.ts') ?? [];
      expect(clientDeps.some(d => d.endsWith('src/components/button/index.ts'))).toBe(true);
    });
  });

  describe('shouldParseForAst', () => {
    it('returns true for normal source files', () => {
      expect(shouldParseForAst('src/index.ts')).toBe(true);
      expect(shouldParseForAst('src/compiler/checker.ts')).toBe(true);
      expect(shouldParseForAst('lib/utils.js')).toBe(true);
      expect(shouldParseForAst('packages/analyzer/src/score.ts')).toBe(true);
      expect(shouldParseForAst('contests/page.tsx')).toBe(true);
      expect(shouldParseForAst('attestation/model.ts')).toBe(true);
    });

    it('returns false for paths containing excluded test/fixture directories', () => {
      // /testdata/
      expect(shouldParseForAst('testdata/foo.ts')).toBe(false);
      expect(shouldParseForAst('tsc/testdata/runner.ts')).toBe(false);
      expect(shouldParseForAst('src/testdata/cases.ts')).toBe(false);

      // /tests/
      expect(shouldParseForAst('tests/cases/compiler/test.ts')).toBe(false);
      expect(shouldParseForAst('src/tests/unit.ts')).toBe(false);

      // /__tests__/
      expect(shouldParseForAst('__tests__/runner.test.ts')).toBe(false);
      expect(shouldParseForAst('src/__tests__/app.test.ts')).toBe(false);

      // /fixtures/
      expect(shouldParseForAst('fixtures/mock.ts')).toBe(false);
      expect(shouldParseForAst('src/fixtures/mock.ts')).toBe(false);

      // /__fixtures__/
      expect(shouldParseForAst('__fixtures__/data.ts')).toBe(false);
      expect(shouldParseForAst('src/__fixtures__/data.ts')).toBe(false);

      // /snapshots/
      expect(shouldParseForAst('snapshots/snap.ts')).toBe(false);
      expect(shouldParseForAst('src/snapshots/snap.ts')).toBe(false);

      // Windows paths with backslashes
      expect(shouldParseForAst('tests\\cases\\compiler\\test.ts')).toBe(false);
      expect(shouldParseForAst('tsc\\testdata\\runner.ts')).toBe(false);
      expect(shouldParseForAst('src\\__tests__\\app.test.ts')).toBe(false);
      expect(shouldParseForAst('src\\fixtures\\mock.ts')).toBe(false);
    });
  });
});
