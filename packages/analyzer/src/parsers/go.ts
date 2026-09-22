import { createRequire } from 'node:module';
import path from 'node:path';
import { readdirSync, existsSync, statSync } from 'node:fs';
import type { LanguageParser } from './types.js';
import {
  TreeSitter,
  parseWithTreeSitter,
  normalizePath,
  safeReadFile,
  fileExistsInRepo,
  recordParserDiagnostic,
} from './base.js';

const require = createRequire(import.meta.url);
const GoGrammar = require('tree-sitter-go');

export class GoParser implements LanguageParser {
  readonly language = 'Go';
  readonly extensions = ['.go'] as const;

  private parser: any;
  private goModuleName: string | null = null;
  private goModChecked = false;

  constructor() {
    this.parser = new TreeSitter();
    this.parser.setLanguage(GoGrammar);
  }

  private detectGoModuleName(repoRoot: string): string | null {
    if (this.goModChecked) {
      return this.goModuleName;
    }
    this.goModChecked = true;
    const modFile = path.resolve(repoRoot, 'go.mod');
    const content = safeReadFile(modFile);
    if (content) {
      const match = content.match(/^module\s+([^\s\r\n]+)/m);
      if (match && match[1]) {
        this.goModuleName = match[1].trim();
      }
    }
    return this.goModuleName;
  }

  extractDependencies(repoRoot: string, filePath: string, content?: string): string[] {
    const fullPath = path.resolve(repoRoot, filePath);
    const code = content !== undefined ? content : safeReadFile(fullPath);

    if (code === null) {
      return [];
    }

    const relativePath = normalizePath(path.relative(repoRoot, fullPath));
    const currentFileDir = path.dirname(fullPath);
    const moduleName = this.detectGoModuleName(repoRoot);

    try {
      return parseWithTreeSitter(this.parser, code, (rootNode) => {
        const dependencies = new Set<string>();

        const addFilesFromDir = (dirPath: string) => {
          try {
            if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
              const entries = readdirSync(dirPath, { withFileTypes: true });
              for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.go') && !entry.name.endsWith('_test.go')) {
                  dependencies.add(normalizePath(path.join(dirPath, entry.name)));
                }
              }
            }
          } catch {
            // ignore fs errors
          }
        };

        const resolveImport = (importPath: string) => {
          // 1. Relative import (e.g. "./local" or "../sibling")
          if (importPath.startsWith('.')) {
            const resolvedDir = path.resolve(currentFileDir, importPath);
            addFilesFromDir(resolvedDir);
            const resolvedFile = `${resolvedDir}.go`;
            if (fileExistsInRepo(repoRoot, resolvedFile)) {
              dependencies.add(normalizePath(resolvedFile));
            }
            return;
          }

          // 2. Module-prefixed import (e.g. "github.com/myorg/myrepo/pkg/auth")
          if (moduleName && importPath.startsWith(moduleName)) {
            const relWithinRepo = importPath.slice(moduleName.length).replace(/^[/\\]+/, '');
            const targetDir = path.resolve(repoRoot, relWithinRepo);
            addFilesFromDir(targetDir);
            const targetFile = `${targetDir}.go`;
            if (fileExistsInRepo(repoRoot, targetFile)) {
              dependencies.add(normalizePath(targetFile));
            }
            return;
          }

          // 3. Direct local package directory in repo (e.g. "pkg/utils" or "internal/auth")
          const directDir = path.resolve(repoRoot, importPath);
          if (existsSync(directDir) && statSync(directDir).isDirectory()) {
            addFilesFromDir(directDir);
          }
        };

        const walk = (node: any) => {
          if (!node) return;

          if (node.type === 'import_spec') {
            const pathNode = node.childForFieldName('path');
            if (pathNode) {
              const text = pathNode.text;
              if (text.startsWith('"') && text.endsWith('"')) {
                resolveImport(text.slice(1, -1));
              }
            }
          }

          for (const child of node.namedChildren) {
            walk(child);
          }
        };

        walk(rootNode);

        return [...dependencies].sort();
      });
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[Parser] Skipping ${relativePath}: ${errorMessage}`);
      recordParserDiagnostic(relativePath, errorMessage);
      return [];
    }
  }
}
