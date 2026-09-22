import { createRequire } from 'node:module';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ParserDiagnostic } from './types.js';

const require = createRequire(import.meta.url);
export const TreeSitter = require('tree-sitter');

export const normalizePath = (filePath: string): string => filePath.replace(/\\/g, '/');

const parserDiagnostics: ParserDiagnostic[] = [];

export const getParserDiagnostics = (): ParserDiagnostic[] => [...parserDiagnostics];
export const clearParserDiagnostics = (): void => {
  parserDiagnostics.length = 0;
};
export const recordParserDiagnostic = (filePath: string, error: string): void => {
  parserDiagnostics.push({ filePath, error });
};

// Lifecycle telemetry for memory-conscious verification
let treeDeletionsCount = 0;
export const getTreeDeletionsCount = (): number => treeDeletionsCount;
export const resetTreeDeletionsCount = (): void => {
  treeDeletionsCount = 0;
};

/**
 * Parses source code with a Tree-sitter parser, extracts data via extractor callback,
 * and guarantees native AST deallocation and parser reset immediately after extraction.
 */
export function parseWithTreeSitter<T>(
  parser: any,
  code: string,
  extractor: (rootNode: any) => T
): T {
  const tree = parser.parse(code);
  try {
    return extractor(tree.rootNode);
  } finally {
    // Explicitly invoke delete() if present (e.g. web-tree-sitter or mock),
    // and reset the native parser state to avoid retaining cached syntax nodes.
    if (tree && typeof tree.delete === 'function') {
      tree.delete();
    }
    treeDeletionsCount++;
    if (parser && typeof parser.reset === 'function') {
      parser.reset();
    }
  }
}

export function safeReadFile(fullPath: string): string | null {
  try {
    return readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Checks if a candidate path exists on disk and is a file inside repoRoot.
 */
export function fileExistsInRepo(repoRoot: string, candidateAbsPath: string): boolean {
  try {
    const normRepo = normalizePath(path.resolve(repoRoot));
    const normCandidate = normalizePath(path.resolve(candidateAbsPath));
    if (!normCandidate.startsWith(normRepo)) {
      return false;
    }
    if (!existsSync(normCandidate)) {
      return false;
    }
    return statSync(normCandidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolves a local relative specifier (starting with './' or '../') against currentFile.
 */
export function resolveLocalRelative(
  repoRoot: string,
  currentFile: string,
  specifier: string,
  extensions: string[]
): string | null {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const absoluteCurrent = path.resolve(repoRoot, currentFile);
  const baseTarget = path.resolve(path.dirname(absoluteCurrent), specifier);

  const candidates: string[] = [baseTarget];

  for (const ext of extensions) {
    candidates.push(`${baseTarget}${ext}`);
  }

  for (const ext of extensions) {
    candidates.push(path.join(baseTarget, `index${ext}`));
  }

  for (const candidate of candidates) {
    if (fileExistsInRepo(repoRoot, candidate)) {
      return normalizePath(candidate);
    }
  }

  return null;
}
