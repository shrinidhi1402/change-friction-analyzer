import { identifyRiskSignals, type GitCommitInfo } from './git.js';

export type FrictionMetricName =
  | 'dependencyImpact'
  | 'changeFrequency'
  | 'coChangeCoupling'
  | 'contributorComplexity'
  | 'historicalRisk';

export type NormalizedMetricKey = FrictionMetricName | 'frictionScore';

const clampScore = (value: number): number => Math.min(100, Math.max(0, value));

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const calculateFrictionScore = (metrics: Record<FrictionMetricName, number>): number => {
  const weighted =
    metrics.dependencyImpact * 0.3 +
    metrics.changeFrequency * 0.25 +
    metrics.coChangeCoupling * 0.2 +
    metrics.contributorComplexity * 0.1 +
    metrics.historicalRisk * 0.15;

  return clampScore(Number(weighted.toFixed(2)));
};

const explainScore = (path: string, metrics: Record<FrictionMetricName, number>, coChangedWith: string[], signalTexts: string[]): string => {
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

export const logNormalize = (value: number, actualMax: number, virtualMaxFloor: number = 0): number => {
  const maxToUse = Math.max(actualMax, virtualMaxFloor);
  if (maxToUse <= 0) return 0;
  return clampScore((Math.log(value + 1) / Math.log(maxToUse + 1)) * 100);
};

export const calculateFileMetrics = ({
  path,
  dependencies,
  dependents,
  changeCount,
  contributorCount,
  coChangedWith,
  history,
  couplingWeight,
  maxMetrics,
}: {
  path: string;
  dependencies: string[];
  dependents: string[];
  changeCount: number;
  contributorCount: number;
  coChangedWith: string[];
  history: GitCommitInfo[] | Map<string, GitCommitInfo[]>;
  couplingWeight: number;
  maxMetrics: {
    dependencySum: number;
    changeCount: number;
    couplingWeight: number;
    contributorCount: number;
    riskSignals: number;
  };
}) => {
  const evidence = identifyRiskSignals(history, path);

  const dependencyImpact = logNormalize(dependencies.length + dependents.length, maxMetrics.dependencySum, 5);
  const changeFrequency = logNormalize(changeCount, maxMetrics.changeCount, 10);
  const coChangeCoupling = logNormalize(couplingWeight, maxMetrics.couplingWeight, 5);
  const contributorComplexity = logNormalize(contributorCount, maxMetrics.contributorCount, 5);
  const historicalRisk = logNormalize(evidence.length, maxMetrics.riskSignals, 3);

  const metricMap = {
    dependencyImpact,
    changeFrequency,
    coChangeCoupling,
    contributorComplexity,
    historicalRisk,
  };

  const frictionScore = calculateFrictionScore(metricMap);
  const explanation = explainScore(path, metricMap, coChangedWith, evidence);

  return {
    path,
    metrics: {
      dependencyImpact,
      changeFrequency,
      coChangeCoupling,
      contributorComplexity,
      historicalRisk,
      frictionScore,
    },
    explanation,
    dependencyCount: dependencies.length,
    dependentCount: dependents.length,
    changeCount,
    contributorCount,
    coChangedWith,
    historicalEvidence: evidence,
  };
};

export const summarizeAnalysis = (files: ReturnType<typeof calculateFileMetrics>[]) => {
  const scores = files.map((file) => file.metrics.frictionScore);
  const avg = average(scores);

  return {
    overallScore: clampScore(Number(avg.toFixed(2))),
    filesAnalyzed: files.length,
    highFrictionFiles: files.filter((file) => file.metrics.frictionScore >= 70).length,
    mediumFrictionFiles: files.filter((file) => file.metrics.frictionScore >= 35 && file.metrics.frictionScore < 70).length,
    lowFrictionFiles: files.filter((file) => file.metrics.frictionScore < 35).length,
    topHighFrictionModules: files
      .filter((file) => file.metrics.frictionScore >= 70)
      .sort((a, b) => b.metrics.frictionScore - a.metrics.frictionScore)
      .slice(0, 5)
      .map((file) => file.path),
  };
};
