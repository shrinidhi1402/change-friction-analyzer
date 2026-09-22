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
const RustGrammar = require('tree-sitter-rust');

export class RustParser implements LanguageParser {
  readonly language = 'Rust';
  readonly extensions = ['.rs'] as const;

  private parser: any;

  constructor() {
    this.parser = new TreeSitter();
    this.parser.setLanguage(RustGrammar);
  }

  extractDependencies(repoRoot: string, filePath: string, content?: string): string[] {
    const fullPath = path.resolve(repoRoot, filePath);
    const code = content !== undefined ? content : safeReadFile(fullPath);

    if (code === null) {
      return [];
    }

    const relativePath = normalizePath(path.relative(repoRoot, fullPath));
    const currentFileDir = path.dirname(fullPath);

    // Locate crate root (directory containing Cargo.toml or src/ directory)
    let crateSrcDir = path.resolve(repoRoot, 'src');
    if (!fileExistsInRepo(repoRoot, path.resolve(crateSrcDir, 'main.rs')) &&
        !fileExistsInRepo(repoRoot, path.resolve(crateSrcDir, 'lib.rs'))) {
      // If src/ doesn't exist, check current file's ancestor with Cargo.toml
      let cur = currentFileDir;
      while (cur.startsWith(path.resolve(repoRoot))) {
        if (fileExistsInRepo(repoRoot, path.join(cur, 'Cargo.toml'))) {
          crateSrcDir = path.join(cur, 'src');
          break;
        }
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
    }

    try {
      return parseWithTreeSitter(this.parser, code, (rootNode) => {
        const dependencies = new Set<string>();

        const checkModCandidates = (baseDir: string, modName: string): string | null => {
          // Candidate 1: <baseDir>/<modName>.rs
          const fileCandidate = path.resolve(baseDir, `${modName}.rs`);
          if (fileExistsInRepo(repoRoot, fileCandidate)) {
            return normalizePath(fileCandidate);
          }

          // Candidate 2: <baseDir>/<modName>/mod.rs
          const modCandidate = path.resolve(baseDir, modName, 'mod.rs');
          if (fileExistsInRepo(repoRoot, modCandidate)) {
            return normalizePath(modCandidate);
          }

          return null;
        };

        const resolveUsePath = (usePathStr: string) => {
          // Standard / external crates to ignore immediately
          if (
            usePathStr.startsWith('std::') ||
            usePathStr.startsWith('core::') ||
            usePathStr.startsWith('alloc::')
          ) {
            return;
          }

          const segments = usePathStr.split('::').map(s => s.replace(/[{};]/g, '').trim()).filter(Boolean);
          if (segments.length === 0) return;

          if (segments[0] === 'crate') {
            // e.g. crate::foo::bar
            const remaining = segments.slice(1);
            if (remaining.length > 0) {
              const matched = checkModCandidates(crateSrcDir, remaining[0]);
              if (matched) dependencies.add(matched);
              if (remaining.length > 1) {
                const subMatched = checkModCandidates(path.join(crateSrcDir, remaining[0]), remaining[1]);
                if (subMatched) dependencies.add(subMatched);
              }
            }
          } else if (segments[0] === 'super') {
            const parentDir = path.dirname(currentFileDir);
            const remaining = segments.slice(1);
            if (remaining.length > 0) {
              const matched = checkModCandidates(parentDir, remaining[0]);
              if (matched) dependencies.add(matched);
            }
          } else if (segments[0] === 'self') {
            const remaining = segments.slice(1);
            if (remaining.length > 0) {
              const matched = checkModCandidates(currentFileDir, remaining[0]);
              if (matched) dependencies.add(matched);
            }
          } else {
            // Could be local module in current directory or crate root: e.g. use foo::Bar;
            const localMatch = checkModCandidates(currentFileDir, segments[0]);
            if (localMatch) {
              dependencies.add(localMatch);
            } else {
              const crateMatch = checkModCandidates(crateSrcDir, segments[0]);
              if (crateMatch) dependencies.add(crateMatch);
            }
          }
        };

        const walk = (node: any) => {
          if (!node) return;

          // mod foo; (module declaration without inline body)
          if (node.type === 'mod_item') {
            const body = node.childForFieldName('body');
            if (!body) {
              const nameNode = node.childForFieldName('name');
              if (nameNode) {
                const modName = nameNode.text;
                const matched = checkModCandidates(currentFileDir, modName);
                if (matched) dependencies.add(matched);
              }
            }
          }

          // use ...
          if (node.type === 'use_declaration') {
            const arg = node.childForFieldName('argument');
            if (arg) {
              resolveUsePath(arg.text);
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
