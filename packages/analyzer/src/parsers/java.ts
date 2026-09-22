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
const JavaGrammar = require('tree-sitter-java');

export class JavaParser implements LanguageParser {
  readonly language = 'Java';
  readonly extensions = ['.java'] as const;

  private parser: any;
  private readonly sourceRoots = [
    '',
    'src/main/java',
    'src/test/java',
    'src',
    'app/src/main/java',
  ];

  constructor() {
    this.parser = new TreeSitter();
    this.parser.setLanguage(JavaGrammar);
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

        const resolveImport = (importPathStr: string): string | null => {
          // Ignore standard Java/Android libraries
          if (
            importPathStr.startsWith('java.') ||
            importPathStr.startsWith('javax.') ||
            importPathStr.startsWith('sun.') ||
            importPathStr.startsWith('android.')
          ) {
            return null;
          }

          const parts = importPathStr.split('.');
          // Candidates:
          // 1. Full path as ClassName.java: a/b/c/ClassName.java
          // 2. If static import (a.b.c.ClassName.method): a/b/c/ClassName.java
          const candidateRelPaths: string[] = [
            parts.join('/') + '.java',
          ];
          if (parts.length > 1) {
            candidateRelPaths.push(parts.slice(0, -1).join('/') + '.java');
          }

          for (const rel of candidateRelPaths) {
            for (const root of this.sourceRoots) {
              const candidate = path.resolve(repoRoot, root, rel);
              if (fileExistsInRepo(repoRoot, candidate)) {
                return normalizePath(candidate);
              }
            }
          }

          return null;
        };

        const walk = (node: any) => {
          if (!node) return;

          if (node.type === 'import_declaration') {
            for (const child of node.children) {
              if (child.type === 'scoped_identifier' || child.type === 'identifier') {
                const resolved = resolveImport(child.text);
                if (resolved) dependencies.add(resolved);
                break;
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
