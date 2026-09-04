import { generateText } from './ollama.js';

export interface FileEvidence {
  path: string;
  metrics: {
    dependencyImpact: number;
    changeFrequency: number;
    coChangeCoupling: number;
    contributorComplexity: number;
    historicalRisk: number;
    frictionScore: number;
  };
  dependencyCount: number;
  dependentCount: number;
  changeCount: number;
  contributorCount: number;
  coChangedWith: string[];
  historicalEvidence: string[];
}

export interface EngineeringBrief {
  whyItMatters: string;
  whatCouldBeAffected: string[];
  beforeYouChangeIt: string[];
}

function getRiskLevel(score: number): string {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

export async function generateEngineeringBrief(evidence: FileEvidence): Promise<EngineeringBrief> {
  const risk = getRiskLevel(evidence.metrics.frictionScore);
  const coChanged = evidence.coChangedWith.slice(0, 3).join(', ') || 'none';

  const prompt = `System Instructions:
Friction score is a 0-100 change-risk/friction score. Higher means a change is more likely to require coordination, broader testing, or affect related code. It does NOT measure code quality.
Use ONLY the evidence below. Make ONLY claims directly supported by the evidence.
Distinguish dependency direction precisely: "dependencies" are modules this file depends on; "dependents" are modules that depend on this file. NEVER refer to dependencies as "dependent modules". Maintain the exact counts and direction given in the evidence.
Do NOT invent code ownership, maintainers, or "owners of X files".
Do NOT make unsupported operational claims such as "before deploying". Keep recommendations grounded strictly in repository evidence (e.g. review dependent modules, inspect relevant co-changed files, review Git history).
Do NOT invent performance problems, bugs, security problems, architecture flaws, unidentified tests, stakeholders, unlisted dependencies, or business impacts.
Do NOT claim dependencies contain "critical functionality" unless explicitly supported by evidence. Instead suggest: "Review dependent modules to understand how changes may affect them."
When discussing regressions, prefer: "Frequent historical changes make broader regression testing advisable." Do not claim regressions actually occurred.
The listed co-changed files are only a sample subset. NEVER state or imply that the listed count is the total number of co-changed files. Use phrases like "the supplied co-changed files", "the highlighted co-changed files", or "the most relevant co-changed files provided".
Recommendations must be directly tied to the supplied metrics and numbers. Do not include unsupported recommendations.
Return concise JSON:
{"whyItMatters":"1-2 sentences explaining why the file has a ${risk} change-friction score based on the numbers","whatCouldBeAffected":["2-4 specific implications supported by the metrics"],"beforeYouChangeIt":["2-4 evidence-based actions"]}

Evidence:
File: ${evidence.path}
Change-Friction Score: ${evidence.metrics.frictionScore.toFixed(1)}/100 (${risk} risk)
Dependents (modules depending on this file): ${evidence.dependentCount}
Dependencies (modules this file depends on): ${evidence.dependencyCount}
Change History: ${evidence.changeCount} changes by ${evidence.contributorCount} contributors
Highlighted Co-changed Files (sample subset): ${coChanged}`;

  try {
    const responseText = await generateText(prompt, {
      json: true,
      numPredict: 256,
      numCtx: 1024,
    });
    const parsed = JSON.parse(responseText);

    return {
      whyItMatters: typeof parsed.whyItMatters === 'string'
        ? parsed.whyItMatters : 'No explanation provided.',
      whatCouldBeAffected: Array.isArray(parsed.whatCouldBeAffected)
        ? parsed.whatCouldBeAffected : [parsed.whatCouldBeAffected ?? 'No affected modules identified.'],
      beforeYouChangeIt: Array.isArray(parsed.beforeYouChangeIt)
        ? parsed.beforeYouChangeIt : [parsed.beforeYouChangeIt ?? 'Proceed with standard caution.'],
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to generate engineering brief: ${error.message}`);
    }
    throw new Error('Failed to generate engineering brief: Unknown error');
  }
}
