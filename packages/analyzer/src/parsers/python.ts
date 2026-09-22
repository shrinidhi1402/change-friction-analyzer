import { createRequire } from 'node:module';
import path from 'node:path';
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
const PythonGrammar = require('tree-sitter-python');

export class PythonParser implements LanguageParser {
  readonly language = 'Python';
  readonly extensions = ['.py'] as const;

  private parser: any;

  constructor() {
    this.parser = new TreeSitter();
    this.parser.setLanguage(PythonGrammar);
  }

  extractDependencies(repoRoot: string, filePath: string, content?: string): string[] {
    const fullPath = path.resolve(repoRoot, filePath);
    const code = content !== undefined ? content : safeReadFile(fullPath);

    if (code === null) {
      return [];
    }

    const relativePath = normalizePath(path.relative(repoRoot, fullPath));

    try {
      return parseWithTreeSitter(this.parser, code, (rootNode) => {
        const dependencies = new Set<string>();
        const currentFileDir = path.dirname(fullPath);

        const checkCandidates = (baseDir: string, moduleSubpath: string): string | null => {
          if (!moduleSubpath) return null;
          const relPath = moduleSubpath.replace(/\./g, '/');
          const fileCandidate = path.resolve(baseDir, `${relPath}.py`);
          if (fileExistsInRepo(repoRoot, fileCandidate)) {
            return normalizePath(fileCandidate);
          }

          const initCandidate = path.resolve(baseDir, relPath, '__init__.py');
          if (fileExistsInRepo(repoRoot, initCandidate)) {
            return normalizePath(initCandidate);
          }

          return null;
        };

        const resolveModule = (moduleName: string): string | null => {
          if (!moduleName) return null;

          // Check current file directory first
          const localMatch = checkCandidates(currentFileDir, moduleName);
          if (localMatch) return localMatch;

          // Check repo root
          const rootMatch = checkCandidates(repoRoot, moduleName);
          if (rootMatch) return rootMatch;

          // Check src/ directory if it exists
          const srcMatch = checkCandidates(path.join(repoRoot, 'src'), moduleName);
          if (srcMatch) return srcMatch;

          return null;
        };

        const walk = (node: any) => {
          if (!node) return;

          // import a, b.c, d as e
          if (node.type === 'import_statement') {
            for (const child of node.namedChildren) {
              if (child.type === 'dotted_name') {
                const resolved = resolveModule(child.text);
                if (resolved) dependencies.add(resolved);
              } else if (child.type === 'aliased_import') {
                const nameChild = child.childForFieldName('name');
                if (nameChild) {
                  const resolved = resolveModule(nameChild.text);
                  if (resolved) dependencies.add(resolved);
                }
              }
            }
          }

          // from ... import ...
          if (node.type === 'import_from_statement') {
            let relativeImportText = '';
            let moduleName = '';
            const importedNames: string[] = [];

            for (const child of node.children) {
              if (child.type === 'relative_import') {
                relativeImportText = child.text; // e.g. '.', '..', '.sub', '..parent'
              } else if (child.type === 'dotted_name' && !relativeImportText && !moduleName) {
                moduleName = child.text;
              }
            }

            let afterImport = false;
            for (const child of node.children) {
              if (child.type === 'import') {
                afterImport = true;
                continue;
              }
              if (afterImport) {
                if (child.type === 'dotted_name' || child.type === 'identifier') {
                  importedNames.push(child.text);
                } else if (child.type === 'aliased_import') {
                  const nameNode = child.childForFieldName('name');
                  if (nameNode) importedNames.push(nameNode.text);
                }
              }
            }

            if (relativeImportText) {
              const dotMatch = relativeImportText.match(/^\.+/);
              const dotCount = dotMatch ? dotMatch[0].length : 1;
              let targetBaseDir = currentFileDir;
              for (let i = 1; i < dotCount; i++) {
                targetBaseDir = path.dirname(targetBaseDir);
              }

              const sub = relativeImportText.slice(dotCount);
              if (sub) {
                const resolved = checkCandidates(targetBaseDir, sub);
                if (resolved) dependencies.add(resolved);
              }

              for (const imported of importedNames) {
                const subCandidate = sub ? `${sub}.${imported}` : imported;
                const resolved = checkCandidates(targetBaseDir, subCandidate);
                if (resolved) dependencies.add(resolved);
              }
            } else if (moduleName) {
              const resolved = resolveModule(moduleName);
              if (resolved) {
                dependencies.add(resolved);
              }
              for (const imported of importedNames) {
                const subResolved = resolveModule(`${moduleName}.${imported}`);
                if (subResolved) dependencies.add(subResolved);
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
