import { createRequire } from 'node:module';
import path from 'node:path';
import type { LanguageParser } from './types.js';
import {
  TreeSitter,
  parseWithTreeSitter,
  normalizePath,
  safeReadFile,
  resolveLocalRelative,
  recordParserDiagnostic,
} from './base.js';

const require = createRequire(import.meta.url);
const JavaScriptGrammar = require('tree-sitter-javascript');

export class JavaScriptParser implements LanguageParser {
  readonly language = 'JavaScript';
  readonly extensions = ['.js', '.jsx', '.mjs', '.cjs'] as const;

  private parser: any;
  private readonly resolvableExtensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

  constructor() {
    this.parser = new TreeSitter();
    this.parser.setLanguage(JavaScriptGrammar);
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
        const specifiers = new Set<string>();

        const walk = (node: any) => {
          if (!node) return;

          // import ... from '...' or export ... from '...'
          if (node.type === 'import_statement' || node.type === 'export_statement') {
            for (const child of node.namedChildren) {
              if (child.type === 'string') {
                const text = child.text.slice(1, -1);
                if (text) specifiers.add(text);
              }
            }
          }

          // require('...') or dynamic import('...')
          if (node.type === 'call_expression') {
            const fn = node.namedChild(0);
            const args = node.namedChild(1);
            if (
              fn &&
              (fn.text === 'require' || fn.type === 'import') &&
              args &&
              args.type === 'arguments'
            ) {
              const firstArg = args.namedChild(0);
              if (firstArg && firstArg.type === 'string') {
                const text = firstArg.text.slice(1, -1);
                if (text) specifiers.add(text);
              }
            }
          }

          for (const child of node.namedChildren) {
            walk(child);
          }
        };

        walk(rootNode);

        const dependencies = new Set<string>();
        for (const specifier of specifiers) {
          if (specifier.startsWith('.')) {
            const resolved = resolveLocalRelative(
              repoRoot,
              filePath,
              specifier,
              this.resolvableExtensions
            );
            if (resolved) {
              dependencies.add(resolved);
            }
          }
        }

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
