import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const ignoredDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo', 'vendor']);
const ignoredFiles = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);

const normalizePath = (filePath: string): string => filePath.replace(/\\/g, '/');

const resolveLocalImport = (repoRoot: string, currentFile: string, specifier: string): string | null => {
  if (!specifier.startsWith('.')) return null;
  const absoluteCurrentFile = path.resolve(repoRoot, currentFile);
  const absolute = path.resolve(path.dirname(absoluteCurrentFile), specifier);
  const candidates = [absolute, `${absolute}.ts`, `${absolute}.tsx`, `${absolute}.js`, `${absolute}.jsx`, path.join(absolute, 'index.ts'), path.join(absolute, 'index.tsx'), path.join(absolute, 'index.js'), path.join(absolute, 'index.jsx')];

  for (const candidate of candidates) {
    try {
      const normalized = normalizePath(path.relative(repoRoot, candidate));
      if (normalized.startsWith('..')) continue;
      let fileExists = false;
      try {
        fileExists = readdirSync(path.dirname(candidate), { withFileTypes: true }).some((entry) => entry.name === path.basename(candidate));
      } catch {
        // directory does not exist
      }
      
      if (fileExists || candidate.endsWith('index.ts') || candidate.endsWith('index.tsx') || candidate.endsWith('index.js') || candidate.endsWith('index.jsx')) {
        const targetPath = path.extname(candidate) ? candidate : undefined;
        if (targetPath) {
          return normalizePath(targetPath);
        }
      }
    } catch {
      // ignore unresolved imports
    }
  }

  return null;
};

export const detectSourceFiles = (repoPath: string): string[] => {
  const results: string[] = [];

  const walk = (currentPath: string): void => {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue;
        walk(path.join(currentPath, entry.name));
        continue;
      }

      if (ignoredFiles.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (sourceExtensions.has(ext)) {
        results.push(normalizePath(path.join(currentPath, entry.name)));
      }
    }
  };

  walk(repoPath);
  return results.sort();
};

export const extractImports = (repoRoot: string, filePath: string, project?: Project): string[] => {
  try {
    const p = project ?? new Project({ compilerOptions: { allowJs: true } });
    const fullPath = path.resolve(repoRoot, filePath);
    const sourceFile = p.getSourceFile(fullPath) ?? p.addSourceFileAtPathIfExists(normalizePath(fullPath));
    const dependencies = new Set<string>();

    if (!sourceFile) return [];

    for (const decl of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = decl.getModuleSpecifierValue();
      if (!moduleSpecifier) continue;
      if (moduleSpecifier.startsWith('.')) {
        const resolved = resolveLocalImport(repoRoot, filePath, moduleSpecifier);
        if (resolved) dependencies.add(resolved);
      }
    }

    for (const decl of sourceFile.getExportDeclarations()) {
      const moduleSpecifier = decl.getModuleSpecifierValue();
      if (!moduleSpecifier) continue;
      if (moduleSpecifier.startsWith('.')) {
        const resolved = resolveLocalImport(repoRoot, filePath, moduleSpecifier);
        if (resolved) dependencies.add(resolved);
      }
    }

    for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = callExpr.getExpression();
      if (expr.getKind() === SyntaxKind.Identifier && expr.getText() === 'require') {
        const args = callExpr.getArguments();
        if (args.length > 0 && args[0].getKind() === SyntaxKind.StringLiteral) {
          const moduleSpecifier = (args[0] as any).getLiteralText();
          if (moduleSpecifier.startsWith('.')) {
            const resolved = resolveLocalImport(repoRoot, filePath, moduleSpecifier);
            if (resolved) dependencies.add(resolved);
          }
        }
      }
    }

    return [...dependencies].sort();
  } catch {
    return [];
  }
};

export const buildDependencyGraph = (repoRoot: string, sourceFiles: string[]): Map<string, string[]> => {
  const graph = new Map<string, string[]>();
  const project = new Project({ compilerOptions: { allowJs: true } });

  const sourceFilesSet = new Set(sourceFiles.map(f => normalizePath(f)));

  // Add all files to the project first to optimize resolution
  for (const filePath of sourceFiles) {
    const fullPath = path.resolve(repoRoot, filePath);
    project.addSourceFileAtPathIfExists(normalizePath(fullPath));
  }

  for (const filePath of sourceFiles) {
    const normalizedFile = normalizePath(filePath);
    const imports = extractImports(repoRoot, normalizedFile, project)
      .filter(dep => sourceFilesSet.has(dep));
    graph.set(normalizedFile, imports);
  }

  return graph;
};
