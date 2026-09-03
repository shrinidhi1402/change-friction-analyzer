export type SourceFileInfo = {
  path: string;
  importPaths: string[];
  importedBy: string[];
  changeCount: number;
  contributors: string[];
  coChangedWith: string[];
  historicalSignals: string[];
};

export type AnalyzerMetrics = {
  path: string;
  dependencyImpact: number;
  changeFrequency: number;
  coChangeCoupling: number;
  contributorComplexity: number;
  historicalRisk: number;
  frictionScore: number;
  explanation: string;
  dependencyCount: number;
  dependentCount: number;
  changeCount: number;
  contributorCount: number;
  coChangedWith: string[];
  historicalEvidence: string[];
};

export type AnalysisInput = {
  repositoryPath: string;
};
