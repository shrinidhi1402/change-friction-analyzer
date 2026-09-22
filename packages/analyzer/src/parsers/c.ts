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
const CGrammar = require('tree-sitter-c');

export class CParser implements LanguageParser {
  readonly language = 'C';
  readonly extensions = ['.c', '.h'] as const;

  private parser: any;
  private readonly searchPaths = ['', 'include', 'inc', 'src'];

  constructor() {
    this.parser = new TreeSitter();
    this.parser.setLanguage(CGrammar);
  }

  extractDependencies(repoRoot: string, filePath: string, content?: string): string[] {
    const fullPath = path.resolve(repoRoot, filePath);
    const code = content !== undefined ? content : safeReadFile(fullPath);

    if (code === null) {
      return [];
    }

    const relativePath = normalizePath(path.relative(repoRoot, fullPath));
    const currentFileDir = path.dirname(fullPath);

    try {
      return parseWithTreeSitter(this.parser, code, (rootNode) => {
        const dependencies = new Set<string>();

        const resolveHeader = (headerPath: string): string | null => {
          // 1. Check relative to current file
          const relativeCandidate = path.resolve(currentFileDir, headerPath);
          if (fileExistsInRepo(repoRoot, relativeCandidate)) {
            return normalizePath(relativeCandidate);
          }

          // 2. Check standard project include paths
          for (const sp of this.searchPaths) {
            const candidate = path.resolve(repoRoot, sp, headerPath);
            if (fileExistsInRepo(repoRoot, candidate)) {
              return normalizePath(candidate);
            }
          }

          return null;
        };

        const walk = (node: any) => {
          if (!node) return;

          if (node.type === 'preproc_include') {
            const pathNode = node.childForFieldName('path');
            if (pathNode) {
              const text = pathNode.text;
              let cleanPath = '';
              if (text.startsWith('"') && text.endsWith('"')) {
                cleanPath = text.slice(1, -1);
              } else if (text.startsWith('<') && text.endsWith('>')) {
                cleanPath = text.slice(1, -1);
              }

              if (cleanPath) {
                const resolved = resolveHeader(cleanPath);
                if (resolved) dependencies.add(resolved);
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
