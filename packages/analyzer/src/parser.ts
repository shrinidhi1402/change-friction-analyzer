import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import path from 'node:path';
import {
  defaultParserRegistry,
  shouldParseForAst,
  getParserDiagnostics,
  clearParserDiagnostics,
  recordParserDiagnostic,
  type ParserDiagnostic,
} from './parsers/index.js';

export {
  defaultParserRegistry,
  shouldParseForAst,
  getParserDiagnostics,
  clearParserDiagnostics,
  recordParserDiagnostic,
  type ParserDiagnostic,
};

export const normalizePath = (filePath: string): string => filePath.replace(/\\/g, '/');

export const detectSourceFiles = (repoPath: string): string[] => {
  return defaultParserRegistry.detectSourceFiles(repoPath);
};

export const detectLanguage = (filePath: string): string | null => {
  return defaultParserRegistry.detectLanguage(filePath);
};

export const getLanguageStats = (repoRoot: string, sourceFiles?: string[]) => {
  return defaultParserRegistry.getLanguageStats(repoRoot, sourceFiles);
};

export const getLanguageBreakdown = (repoRoot: string, sourceFiles?: string[]) => {
  return defaultParserRegistry.getLanguageBreakdown(repoRoot, sourceFiles);
};

export const getFileLanguageInfo = (filePath: string) => {
  return defaultParserRegistry.getFileLanguageInfo(filePath);
};

/**
 * Legacy ts-morph helper kept strictly for backward compatibility when an explicit
 * ts-morph Project instance is supplied by a caller.
 */
function extractWithTsMorphProject(repoRoot: string, filePath: string, project: Project): string[] {
  const fullPath = path.resolve(repoRoot, filePath);
  const normalizedFullPath = normalizePath(fullPath);
  const relativePath = normalizePath(path.relative(repoRoot, fullPath));

  if (!shouldParseForAst(relativePath)) {
    return [];
  }

  let sourceFile: SourceFile | undefined;
  try {
    sourceFile = project.getSourceFile(fullPath) ?? project.getSourceFile(normalizedFullPath);
    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPathIfExists(normalizedFullPath);
    }
    if (!sourceFile) return [];

    const dependencies = new Set<string>();

    for (const decl of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = decl.getModuleSpecifierValue();
      if (!moduleSpecifier) continue;
      if (moduleSpecifier.startsWith('.')) {
        const resolved = defaultParserRegistry.extractDependencies(repoRoot, filePath);
        for (const r of resolved) dependencies.add(r);
      }
    }

    for (const decl of sourceFile.getExportDeclarations()) {
      const moduleSpecifier = decl.getModuleSpecifierValue();
      if (!moduleSpecifier) continue;
      if (moduleSpecifier.startsWith('.')) {
        const resolved = defaultParserRegistry.extractDependencies(repoRoot, filePath);
        for (const r of resolved) dependencies.add(r);
      }
    }

    for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = callExpr.getExpression();
      if (expr.getKind() === SyntaxKind.Identifier && expr.getText() === 'require') {
        const args = callExpr.getArguments();
        if (args.length > 0 && args[0].getKind() === SyntaxKind.StringLiteral) {
          const moduleSpecifier = (args[0] as any).getLiteralText();
          if (moduleSpecifier.startsWith('.')) {
            const resolved = defaultParserRegistry.extractDependencies(repoRoot, filePath);
            for (const r of resolved) dependencies.add(r);
          }
        }
      }
    }

    return [...dependencies].sort();
  } catch (err: any) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[Parser] Skipping ${relativePath}: ${errorMessage}`);
    return [];
  }
}

/**
 * Extracts dependencies for a file. Uses the language-independent Tree-sitter registry
 * by default. If a ts-morph Project is explicitly provided, maintains public API compatibility.
 */
export const extractImports = (repoRoot: string, filePath: string, project?: Project): string[] => {
  const fullPath = path.resolve(repoRoot, filePath);
  const relativePath = normalizePath(path.relative(repoRoot, fullPath));

  try {
    if (project) {
      return extractWithTsMorphProject(repoRoot, filePath, project);
    }
    return defaultParserRegistry.extractDependencies(repoRoot, filePath);
  } catch (err: any) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[Parser] Skipping ${relativePath}: ${errorMessage}`);
    recordParserDiagnostic(relativePath, errorMessage);
    return [];
  }
};

/**
 * Builds the repository dependency graph using the language-independent Tree-sitter registry.
 * Maps absolute normalized file paths to arrays of absolute normalized dependency paths.
 */
export const buildDependencyGraph = (repoRoot: string, sourceFiles: string[]): Map<string, string[]> => {
  return defaultParserRegistry.buildDependencyGraph(repoRoot, sourceFiles);
};
