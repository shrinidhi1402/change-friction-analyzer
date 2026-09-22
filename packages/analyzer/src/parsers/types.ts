export type LanguageSupportState = 'supported' | 'unsupported' | 'unknown';

export interface FileLanguageInfo {
  language: string | null;
  state: LanguageSupportState;
}

export interface LanguageParser {
  readonly language: string;
  readonly extensions: readonly string[];
  extractDependencies(repoRoot: string, filePath: string, content?: string): string[];
}

export interface ParserDiagnostic {
  filePath: string;
  error: string;
}

export interface LanguageStats {
  [language: string]: number;
}

export interface LanguageBreakdown {
  supported: Record<string, number>;
  unsupported: Record<string, number>;
  unknown: number;
}
