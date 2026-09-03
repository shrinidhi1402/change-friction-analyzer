export type FrictionMetricName =
  | 'dependencyImpact'
  | 'changeFrequency'
  | 'coChangeCoupling'
  | 'contributorComplexity'
  | 'historicalRisk';

export type FileMetricSummary = {
  path: string;
  metrics: {
    dependencyImpact: number;
    changeFrequency: number;
    coChangeCoupling: number;
    contributorComplexity: number;
    historicalRisk: number;
    frictionScore: number;
  };
  explanation: string;
  dependencyCount: number;
  dependentCount: number;
  changeCount: number;
  contributorCount: number;
  coChangedWith: string[];
  historicalEvidence: string[];
};

export type AnalysisResult = {
  repositoryPath: string;
  generatedAt: string;
  files: FileMetricSummary[];
  overallScore: number;
  summary: {
    filesAnalyzed: number;
    highFrictionFiles: number;
    mediumFrictionFiles: number;
    lowFrictionFiles: number;
    topHighFrictionModules: string[];
  };
};

export const clampScore = (value: number): number => Math.min(100, Math.max(0, value));

export const calculateFrictionScore = (metrics: Record<FrictionMetricName, number>): number => {
  const weighted =
    metrics.dependencyImpact * 0.3 +
    metrics.changeFrequency * 0.25 +
    metrics.coChangeCoupling * 0.2 +
    metrics.contributorComplexity * 0.1 +
    metrics.historicalRisk * 0.15;

  return clampScore(Number(weighted.toFixed(2)));
};

export const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const explainScore = (path: string, metrics: Record<FrictionMetricName, number>, coChangedWith: string[], signalTexts: string[]): string => {
  const reasons: string[] = [];

  if (metrics.dependencyImpact >= 70) reasons.push('a large dependency blast radius');
  if (metrics.changeFrequency >= 70) reasons.push('frequent changes');
  if (metrics.coChangeCoupling >= 70) reasons.push(`frequent co-change with ${coChangedWith.slice(0, 2).join(', ') || 'related modules'}`);
  if (metrics.contributorComplexity >= 60) reasons.push('many contributors touching the module');
  if (metrics.historicalRisk >= 60) reasons.push('historical risk signals');

  const base = `${path} has high change friction because it has ${reasons.join(', ')}.`;
  const evidence = signalTexts.length > 0 ? ` Historical evidence includes: ${signalTexts.slice(0, 2).join('; ')}.` : '';
  return `${base}${evidence}`;
};
