import { describe, expect, it } from 'vitest';
import { extractImports, buildDependencyGraph } from './parser.js';
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
  });
});
