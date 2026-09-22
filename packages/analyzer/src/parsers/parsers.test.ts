import { describe, expect, it, vi, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  ParserRegistry,
  defaultParserRegistry,
  shouldParseForAst,
  getParserDiagnostics,
  clearParserDiagnostics,
  getTreeDeletionsCount,
  resetTreeDeletionsCount,
  parseWithTreeSitter,
} from './index.js';

describe('Tree-sitter Language Parsers & Registry', () => {
  let tempDir: string;

  beforeEach(() => {
    clearParserDiagnostics();
    resetTreeDeletionsCount();
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'tree-sitter-test-'));
  });

  const cleanup = () => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  };

  // ---------------------------------------------------------------------------
  // 1. LANGUAGE DETECTION
  // ---------------------------------------------------------------------------
  describe('Language Detection & State Classification', () => {
    it('detects all 8 supported languages by file extension', () => {
      const registry = new ParserRegistry();

      expect(registry.detectLanguage('app.js')).toBe('JavaScript');
      expect(registry.detectLanguage('component.jsx')).toBe('JavaScript');
      expect(registry.detectLanguage('module.mjs')).toBe('JavaScript');
      expect(registry.detectLanguage('script.cjs')).toBe('JavaScript');

      expect(registry.detectLanguage('index.ts')).toBe('TypeScript');
      expect(registry.detectLanguage('App.tsx')).toBe('TypeScript');
      expect(registry.detectLanguage('types.mts')).toBe('TypeScript');
      expect(registry.detectLanguage('config.cts')).toBe('TypeScript');

      expect(registry.detectLanguage('main.py')).toBe('Python');
      expect(registry.detectLanguage('Service.java')).toBe('Java');
      expect(registry.detectLanguage('driver.c')).toBe('C');
      expect(registry.detectLanguage('header.h')).toBe('C');
      expect(registry.detectLanguage('engine.cpp')).toBe('C++');
      expect(registry.detectLanguage('util.hpp')).toBe('C++');
      expect(registry.detectLanguage('server.go')).toBe('Go');
      expect(registry.detectLanguage('lib.rs')).toBe('Rust');
    });

    it('distinguishes supported, recognized unsupported, and unknown language states', () => {
      const registry = new ParserRegistry();

      // Supported and analyzed
      const pyInfo = registry.getFileLanguageInfo('analyzer.py');
      expect(pyInfo).toEqual({ language: 'Python', state: 'supported' });

      const tsInfo = registry.getFileLanguageInfo('service.ts');
      expect(tsInfo).toEqual({ language: 'TypeScript', state: 'supported' });

      // Recognized but unsupported (dependency extraction skipped)
      const rbInfo = registry.getFileLanguageInfo('app.rb');
      expect(rbInfo).toEqual({ language: 'Ruby', state: 'unsupported' });

      const csInfo = registry.getFileLanguageInfo('Program.cs');
      expect(csInfo).toEqual({ language: 'C#', state: 'unsupported' });

      const mdInfo = registry.getFileLanguageInfo('README.md');
      expect(mdInfo).toEqual({ language: 'Markdown', state: 'unsupported' });

      // Unknown file type
      const unknownInfo = registry.getFileLanguageInfo('data.xyz');
      expect(unknownInfo).toEqual({ language: null, state: 'unknown' });

      const noExtInfo = registry.getFileLanguageInfo('Makefile');
      expect(noExtInfo).toEqual({ language: null, state: 'unknown' });
    });

    it('generates repository-level language statistics as integer file counts', () => {
      const registry = new ParserRegistry();
      const files = [
        'src/index.ts',
        'src/app.tsx',
        'src/util.ts',
        'scripts/build.js',
        'ml/train.py',
        'ml/eval.py',
        'core/native.c',
      ];

      const stats = registry.getLanguageStats(tempDir, files);
      expect(stats).toEqual({
        TypeScript: 3,
        JavaScript: 1,
        Python: 2,
        C: 1,
      });

      // Clear breakdown test
      const breakdown = registry.getLanguageBreakdown(tempDir, [
        ...files,
        'doc/notes.md',
        'config.yaml',
        'blob.bin',
      ]);
      expect(breakdown.supported).toEqual({
        TypeScript: 3,
        JavaScript: 1,
        Python: 2,
        C: 1,
      });
      expect(breakdown.unsupported).toEqual({
        Markdown: 1,
        YAML: 1,
      });
      expect(breakdown.unknown).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. LOCAL DEPENDENCY EXTRACTION (ALL 8 LANGUAGES)
  // ---------------------------------------------------------------------------
  describe('Local Dependency Extraction', () => {
    it('extracts JavaScript dependencies (import, export-from, require, dynamic import)', () => {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const fileA = path.join(srcDir, 'a.js');
      const fileB = path.join(srcDir, 'b.js');
      const fileC = path.join(srcDir, 'c.js');
      const fileD = path.join(srcDir, 'd.js');

      fs.writeFileSync(fileB, 'export const b = 1;');
      fs.writeFileSync(fileC, 'module.exports = { c: 2 };');
      fs.writeFileSync(fileD, 'export const d = 3;');
      fs.writeFileSync(
        fileA,
        `
        import { b } from './b';
        const c = require('./c');
        export { d } from './d';
        const load = () => import('./b');
        `
      );

      const registry = new ParserRegistry();
      const deps = registry.extractDependencies(tempDir, fileA);
      cleanup();

      expect(deps.some(d => d.endsWith('src/b.js'))).toBe(true);
      expect(deps.some(d => d.endsWith('src/c.js'))).toBe(true);
      expect(deps.some(d => d.endsWith('src/d.js'))).toBe(true);
    });

    it('extracts TypeScript & TSX dependencies', () => {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const fileApp = path.join(srcDir, 'App.tsx');
      const fileBtn = path.join(srcDir, 'Button.tsx');
      const fileTypes = path.join(srcDir, 'types.ts');

      fs.writeFileSync(fileBtn, 'export const Button = () => null;');
      fs.writeFileSync(fileTypes, 'export type Props = {};');
      fs.writeFileSync(
        fileApp,
        `
        import React from 'react';
        import { Button } from './Button';
        import type { Props } from './types';
        export const App = () => <Button />;
        `
      );

      const registry = new ParserRegistry();
      const deps = registry.extractDependencies(tempDir, fileApp);
      cleanup();

      expect(deps.some(d => d.endsWith('src/Button.tsx'))).toBe(true);
      expect(deps.some(d => d.endsWith('src/types.ts'))).toBe(true);
      expect(deps.some(d => d.includes('react'))).toBe(false);
    });

    it('extracts Python dependencies (relative and package imports)', () => {
      const pkgDir = path.join(tempDir, 'mypkg');
      const subDir = path.join(pkgDir, 'sub');
      fs.mkdirSync(subDir, { recursive: true });

      const fileInit = path.join(pkgDir, '__init__.py');
      const fileUtils = path.join(pkgDir, 'utils.py');
      const fileMain = path.join(pkgDir, 'main.py');
      const fileHelper = path.join(subDir, 'helper.py');

      fs.writeFileSync(fileInit, '');
      fs.writeFileSync(fileUtils, 'def add(a, b): return a + b');
      fs.writeFileSync(fileHelper, 'from ..utils import add');
      fs.writeFileSync(
        fileMain,
        `
        import mypkg.utils
        from .utils import add
        from .sub import helper
        import os
        import requests
        `
      );

      const registry = new ParserRegistry();
      const mainDeps = registry.extractDependencies(tempDir, fileMain);
      const helperDeps = registry.extractDependencies(tempDir, fileHelper);
      cleanup();

      expect(mainDeps.some(d => d.endsWith('mypkg/utils.py'))).toBe(true);
      expect(mainDeps.some(d => d.endsWith('mypkg/sub/helper.py'))).toBe(true);
      expect(helperDeps.some(d => d.endsWith('mypkg/utils.py'))).toBe(true);
    });

    it('extracts Java dependencies from project source roots', () => {
      const javaDir = path.join(tempDir, 'src/main/java/com/example/service');
      const utilDir = path.join(tempDir, 'src/main/java/com/example/util');
      fs.mkdirSync(javaDir, { recursive: true });
      fs.mkdirSync(utilDir, { recursive: true });

      const fileService = path.join(javaDir, 'UserService.java');
      const fileHelper = path.join(utilDir, 'FormatHelper.java');

      fs.writeFileSync(fileHelper, 'package com.example.util;\npublic class FormatHelper {}');
      fs.writeFileSync(
        fileService,
        `
        package com.example.service;
        import com.example.util.FormatHelper;
        import java.util.List;
        import org.springframework.stereotype.Service;
        public class UserService {}
        `
      );

      const registry = new ParserRegistry();
      const deps = registry.extractDependencies(tempDir, fileService);
      cleanup();

      expect(deps.some(d => d.endsWith('com/example/util/FormatHelper.java'))).toBe(true);
      expect(deps.some(d => d.includes('java.util'))).toBe(false);
      expect(deps.some(d => d.includes('springframework'))).toBe(false);
    });

    it('extracts C and C++ local quoted includes while ignoring system headers', () => {
      const srcDir = path.join(tempDir, 'src');
      const incDir = path.join(tempDir, 'include');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(incDir, { recursive: true });

      const fileC = path.join(srcDir, 'main.c');
      const fileLocalH = path.join(srcDir, 'local.h');
      const fileIncH = path.join(incDir, 'project.h');

      const fileCpp = path.join(srcDir, 'engine.cpp');
      const fileHpp = path.join(incDir, 'engine.hpp');

      fs.writeFileSync(fileLocalH, '#pragma once');
      fs.writeFileSync(fileIncH, '#pragma once');
      fs.writeFileSync(fileHpp, '#pragma once');
      fs.writeFileSync(
        fileC,
        `
        #include "local.h"
        #include "project.h"
        #include <stdio.h>
        #include <stdlib.h>
        `
      );
      fs.writeFileSync(
        fileCpp,
        `
        #include "engine.hpp"
        #include <iostream>
        #include <vector>
        `
      );

      const registry = new ParserRegistry();
      const cDeps = registry.extractDependencies(tempDir, fileC);
      const cppDeps = registry.extractDependencies(tempDir, fileCpp);
      cleanup();

      expect(cDeps.some(d => d.endsWith('src/local.h'))).toBe(true);
      expect(cDeps.some(d => d.endsWith('include/project.h'))).toBe(true);
      expect(cppDeps.some(d => d.endsWith('include/engine.hpp'))).toBe(true);
    });

    it('extracts Go relative imports and module-prefixed packages', () => {
      const goMod = path.join(tempDir, 'go.mod');
      const mainDir = path.join(tempDir, 'cmd');
      const pkgDir = path.join(tempDir, 'pkg/calc');
      fs.mkdirSync(mainDir, { recursive: true });
      fs.mkdirSync(pkgDir, { recursive: true });

      fs.writeFileSync(goMod, 'module github.com/example/app\ngo 1.22\n');
      const fileCalc = path.join(pkgDir, 'calc.go');
      const fileMain = path.join(mainDir, 'main.go');

      fs.writeFileSync(fileCalc, 'package calc\nfunc Add(a, b int) int { return a + b }');
      fs.writeFileSync(
        fileMain,
        `
        package main
        import (
          "fmt"
          "github.com/example/app/pkg/calc"
          "os"
        )
        func main() {}
        `
      );

      const registry = new ParserRegistry();
      const deps = registry.extractDependencies(tempDir, fileMain);
      cleanup();

      expect(deps.some(d => d.endsWith('pkg/calc/calc.go'))).toBe(true);
      expect(deps.some(d => d.includes('fmt'))).toBe(false);
      expect(deps.some(d => d.includes('os'))).toBe(false);
    });

    it('extracts Rust mod declarations and crate-relative use statements', () => {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const fileCargo = path.join(tempDir, 'Cargo.toml');
      const fileLib = path.join(srcDir, 'lib.rs');
      const fileParser = path.join(srcDir, 'parser.rs');
      const fileUtil = path.join(srcDir, 'util.rs');

      fs.writeFileSync(fileCargo, '[package]\nname = "demo"\nversion = "0.1.0"\n');
      fs.writeFileSync(fileParser, 'pub fn parse() {}');
      fs.writeFileSync(fileUtil, 'use crate::parser::parse;');
      fs.writeFileSync(
        fileLib,
        `
        mod parser;
        mod util;
        use std::collections::HashMap;
        use crate::parser::parse;
        `
      );

      const registry = new ParserRegistry();
      const libDeps = registry.extractDependencies(tempDir, fileLib);
      const utilDeps = registry.extractDependencies(tempDir, fileUtil);
      cleanup();

      expect(libDeps.some(d => d.endsWith('src/parser.rs'))).toBe(true);
      expect(libDeps.some(d => d.endsWith('src/util.rs'))).toBe(true);
      expect(utilDeps.some(d => d.endsWith('src/parser.rs'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. UNRESOLVED EXTERNAL DEPENDENCY HANDLING
  // ---------------------------------------------------------------------------
  describe('Unresolved External Dependency Handling', () => {
    it('ignores external packages across all languages without inventing fake files', () => {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const fileJs = path.join(srcDir, 'externals.js');
      const filePy = path.join(srcDir, 'externals.py');
      const fileJava = path.join(srcDir, 'Externals.java');
      const fileC = path.join(srcDir, 'externals.c');
      const fileGo = path.join(srcDir, 'externals.go');
      const fileRs = path.join(srcDir, 'externals.rs');

      fs.writeFileSync(fileJs, 'require("express"); require("lodash"); import "dotenv/config";');
      fs.writeFileSync(filePy, 'import os, sys\nimport requests\nfrom numpy import array\nimport non_existent_pkg');
      fs.writeFileSync(fileJava, 'package com.test;\nimport java.util.*;\nimport org.apache.commons.lang3.StringUtils;');
      fs.writeFileSync(fileC, '#include <stdio.h>\n#include <stdlib.h>\n#include <windows.h>');
      fs.writeFileSync(fileGo, 'package main\nimport "fmt"\nimport "net/http"\nimport "github.com/external/pkg"');
      fs.writeFileSync(fileRs, 'use std::io;\nuse serde::Deserialize;\nuse external_crate::Thing;');

      const registry = new ParserRegistry();

      expect(registry.extractDependencies(tempDir, fileJs)).toEqual([]);
      expect(registry.extractDependencies(tempDir, filePy)).toEqual([]);
      expect(registry.extractDependencies(tempDir, fileJava)).toEqual([]);
      expect(registry.extractDependencies(tempDir, fileC)).toEqual([]);
      expect(registry.extractDependencies(tempDir, fileGo)).toEqual([]);
      expect(registry.extractDependencies(tempDir, fileRs)).toEqual([]);

      cleanup();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. UNSUPPORTED / UNKNOWN FILE HANDLING
  // ---------------------------------------------------------------------------
  describe('Unsupported & Unknown File Handling', () => {
    it('returns empty dependencies for unsupported and unknown files without error', () => {
      const srcDir = path.join(tempDir, 'files');
      fs.mkdirSync(srcDir, { recursive: true });

      const mdFile = path.join(srcDir, 'README.md');
      const binFile = path.join(srcDir, 'asset.bin');
      const txtFile = path.join(srcDir, 'notes.txt');

      fs.writeFileSync(mdFile, '# Heading\n[link](./notes.txt)');
      fs.writeFileSync(binFile, '010101');
      fs.writeFileSync(txtFile, 'plain text');

      const registry = new ParserRegistry();

      expect(registry.extractDependencies(tempDir, mdFile)).toEqual([]);
      expect(registry.extractDependencies(tempDir, binFile)).toEqual([]);
      expect(registry.extractDependencies(tempDir, txtFile)).toEqual([]);

      // In dependency graph, unsupported files are included with empty dependencies
      const graph = registry.buildDependencyGraph(tempDir, [mdFile, binFile, txtFile]);
      expect(graph.get(mdFile.replace(/\\/g, '/'))).toEqual([]);
      expect(graph.get(binFile.replace(/\\/g, '/'))).toEqual([]);

      cleanup();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. PARSER FAILURE ISOLATION
  // ---------------------------------------------------------------------------
  describe('Parser Failure Isolation', () => {
    it('isolates parser exceptions to the failing file and continues repository analysis', () => {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const fileGood = path.join(srcDir, 'good.ts');
      const fileDep = path.join(srcDir, 'dep.ts');
      const fileBad = path.join(srcDir, 'bad.ts');

      fs.writeFileSync(fileDep, 'export const answer = 42;');
      fs.writeFileSync(fileGood, 'import { answer } from "./dep";');
      fs.writeFileSync(fileBad, 'invalid syntax {{{');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const registry = new ParserRegistry();
      const files = [fileGood, fileDep, fileBad];
      const graph = registry.buildDependencyGraph(tempDir, files);

      cleanup();
      warnSpy.mockRestore();

      // All files exist in graph
      const normGood = fileGood.replace(/\\/g, '/');
      const normDep = fileDep.replace(/\\/g, '/');
      const normBad = fileBad.replace(/\\/g, '/');

      expect(graph.has(normGood)).toBe(true);
      expect(graph.has(normDep)).toBe(true);
      expect(graph.has(normBad)).toBe(true);

      // Good file resolved its dependency
      const goodDeps = graph.get(normGood) ?? [];
      expect(goodDeps.some(d => d.endsWith('src/dep.ts'))).toBe(true);

      // Bad file has empty dependencies
      expect(graph.get(normBad)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. MEMORY-CONSCIOUS PROCESSING BEHAVIOR
  // ---------------------------------------------------------------------------
  describe('Memory-Conscious Sequential Deallocation', () => {
    it('executes tree deallocation and parser reset after every file parsed', () => {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const file1 = path.join(srcDir, 'f1.py');
      const file2 = path.join(srcDir, 'f2.py');
      const file3 = path.join(srcDir, 'f3.py');

      fs.writeFileSync(file1, 'x = 1');
      fs.writeFileSync(file2, 'y = 2');
      fs.writeFileSync(file3, 'z = 3');

      resetTreeDeletionsCount();

      const registry = new ParserRegistry();
      const files = [file1, file2, file3];
      const graph = registry.buildDependencyGraph(tempDir, files);

      cleanup();

      // Verified: parseWithTreeSitter runs sequentially and increments the deallocation count for each file
      expect(getTreeDeletionsCount()).toBe(3);
      expect(graph.size).toBe(3);
    });

    it('verifies parseWithTreeSitter invokes delete() on the tree when available', () => {
      const mockDelete = vi.fn();
      const mockReset = vi.fn();
      const mockTree = {
        rootNode: { type: 'module', namedChildren: [] },
        delete: mockDelete,
      };
      const mockParser = {
        parse: vi.fn(() => mockTree),
        reset: mockReset,
      };

      const result = parseWithTreeSitter(mockParser, 'code', (root) => {
        expect(root.type).toBe('module');
        return 'extracted';
      });

      expect(result).toBe('extracted');
      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockReset).toHaveBeenCalledTimes(1);
    });
  });
});
