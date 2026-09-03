export type FrictionMetricName = 'dependencyImpact' | 'changeFrequency' | 'coChangeCoupling' | 'contributorComplexity' | 'historicalRisk';
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
export declare const clampScore: (value: number) => number;
export declare const calculateFrictionScore: (metrics: Record<FrictionMetricName, number>) => number;
export declare const average: (values: number[]) => number;
export declare const explainScore: (path: string, metrics: Record<FrictionMetricName, number>, coChangedWith: string[], signalTexts: string[]) => string;
