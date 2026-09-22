import path from 'node:path';
import { readdirSync } from 'node:fs';
import type {
  LanguageParser,
  FileLanguageInfo,
  LanguageSupportState,
  LanguageBreakdown,
  LanguageStats,
} from './types.js';
import {
  normalizePath,
  recordParserDiagnostic,
  getParserDiagnostics,
  clearParserDiagnostics,
} from './base.js';
import { JavaScriptParser } from './javascript.js';
import { TypeScriptParser } from './typescript.js';
import { PythonParser } from './python.js';
import { JavaParser } from './java.js';
import { CParser } from './c.js';
import { CppParser } from './cpp.js';
import { GoParser } from './go.js';
import { RustParser } from './rust.js';

const ignoredDirs = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'vendor',
  'target',
  'out',
  '.next',
  '.turbo',
  '.idea',
  '.vscode',
]);

const ignoredFiles = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'composer.lock',
  'go.sum',
]);

const excludedAstPatterns = [
  /(?:^|\/)(testdata|tests|__tests__|fixtures|__fixtures__|snapshots)(?:\/|$)/i,
];

export const shouldParseForAst = (relativePath: string): boolean => {
  if (!relativePath) return false;
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return !excludedAstPatterns.some((pattern) => pattern.test(normalized));
};

const recognizedUnsupportedExtensions: Record<string, string> = {
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.scala': 'Scala',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'Sass',
  '.less': 'Less',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.xml': 'XML',
  '.sql': 'SQL',
  '.md': 'Markdown',
  '.dart': 'Dart',
  '.lua': 'Lua',
  '.r': 'R',
};

export class ParserRegistry {
  private parsersByExtension = new Map<string, LanguageParser>();
  private parsersByName = new Map<string, LanguageParser>();

  constructor() {
    this.registerParser(new JavaScriptParser());
    this.registerParser(new TypeScriptParser());
    this.registerParser(new PythonParser());
    this.registerParser(new JavaParser());
    this.registerParser(new CParser());
    this.registerParser(new CppParser());
    this.registerParser(new GoParser());
    this.registerParser(new RustParser());
  }

  registerParser(parser: LanguageParser): void {
    this.parsersByName.set(parser.language.toLowerCase(), parser);
    for (const ext of parser.extensions) {
      this.parsersByExtension.set(ext.toLowerCase(), parser);
    }
  }

  getParserForFile(filePath: string): LanguageParser | undefined {
    const ext = path.extname(filePath).toLowerCase();
    return this.parsersByExtension.get(ext);
  }

  getSupportedExtensions(): string[] {
    return [...this.parsersByExtension.keys()].sort();
  }

  getFileLanguageInfo(filePath: string): FileLanguageInfo {
    const ext = path.extname(filePath).toLowerCase();
    const parser = this.parsersByExtension.get(ext);
    if (parser) {
      return {
        language: parser.language,
        state: 'supported',
      };
    }

    const unsupportedLang = recognizedUnsupportedExtensions[ext];
    if (unsupportedLang) {
      return {
        language: unsupportedLang,
        state: 'unsupported',
      };
    }

    return {
      language: null,
      state: 'unknown',
    };
  }

  detectLanguage(filePath: string): string | null {
    return this.getFileLanguageInfo(filePath).language;
  }

  getLanguageSupportState(filePath: string): LanguageSupportState {
    return this.getFileLanguageInfo(filePath).state;
  }

  detectSourceFiles(repoPath: string): string[] {
    const results: string[] = [];

    const walk = (currentPath: string): void => {
      let entries;
      try {
        entries = readdirSync(currentPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (ignoredDirs.has(entry.name)) continue;
          walk(path.join(currentPath, entry.name));
          continue;
        }

        if (ignoredFiles.has(entry.name)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (this.parsersByExtension.has(ext)) {
          results.push(normalizePath(path.join(currentPath, entry.name)));
        }
      }
    };

    walk(repoPath);
    return results.sort();
  }

  getLanguageStats(repoRoot: string, sourceFiles?: string[]): LanguageStats {
    const files = sourceFiles ?? this.detectSourceFiles(repoRoot);
    const stats: LanguageStats = {};

    for (const file of files) {
      const info = this.getFileLanguageInfo(file);
      if (info.state === 'supported' && info.language) {
        stats[info.language] = (stats[info.language] ?? 0) + 1;
      }
    }

    return stats;
  }

  getLanguageBreakdown(repoRoot: string, allFiles?: string[]): LanguageBreakdown {
    const breakdown: LanguageBreakdown = {
      supported: {},
      unsupported: {},
      unknown: 0,
    };

    const files = allFiles ?? this.detectSourceFiles(repoRoot);
    for (const file of files) {
      const info = this.getFileLanguageInfo(file);
      if (info.state === 'supported' && info.language) {
        breakdown.supported[info.language] = (breakdown.supported[info.language] ?? 0) + 1;
      } else if (info.state === 'unsupported' && info.language) {
        breakdown.unsupported[info.language] = (breakdown.unsupported[info.language] ?? 0) + 1;
      } else {
        breakdown.unknown++;
      }
    }

    return breakdown;
  }

  extractDependencies(repoRoot: string, filePath: string, content?: string): string[] {
    const fullPath = path.resolve(repoRoot, filePath);
    const relativePath = normalizePath(path.relative(repoRoot, fullPath));

    if (!shouldParseForAst(relativePath)) {
      return [];
    }

    const parser = this.getParserForFile(filePath);
    if (!parser) {
      // Unsupported or unknown language: skip dependency extraction cleanly without error
      return [];
    }

    try {
      return parser.extractDependencies(repoRoot, filePath, content);
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[Parser] Skipping ${relativePath}: ${errorMessage}`);
      recordParserDiagnostic(relativePath, errorMessage);
      return [];
    }
  }

  buildDependencyGraph(repoRoot: string, sourceFiles: string[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    const sourceFilesSet = new Set<string>();
    for (const f of sourceFiles) {
      const normalized = normalizePath(f);
      const resolved = normalizePath(path.resolve(repoRoot, f));
      const relative = normalizePath(path.relative(repoRoot, resolved));
      sourceFilesSet.add(normalized);
      sourceFilesSet.add(resolved);
      sourceFilesSet.add(relative);
    }

    // Process files sequentially one by one, releasing AST memory immediately per file
    for (const filePath of sourceFiles) {
      const normalizedFile = normalizePath(filePath);
      const fullPath = path.resolve(repoRoot, filePath);
      const relativePath = normalizePath(path.relative(repoRoot, fullPath));

      if (!shouldParseForAst(relativePath)) {
        graph.set(normalizedFile, []);
        continue;
      }

      try {
        const imports = this.extractDependencies(repoRoot, normalizedFile)
          .filter((dep) => {
            const normDep = normalizePath(dep);
            const relDep = normalizePath(path.relative(repoRoot, dep));
            return sourceFilesSet.has(normDep) || sourceFilesSet.has(relDep);
          });
        graph.set(normalizedFile, imports);
      } catch (err: any) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.warn(`[Parser] Skipping ${relativePath}: ${errorMessage}`);
        recordParserDiagnostic(relativePath, errorMessage);
        graph.set(normalizedFile, []);
      }
    }

    return graph;
  }
}

export const defaultParserRegistry = new ParserRegistry();
export { getParserDiagnostics, clearParserDiagnostics };
