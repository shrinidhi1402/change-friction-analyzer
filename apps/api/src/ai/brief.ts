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

export function enforceGrounding(text: string, evidence: FileEvidence): string {
  if (!text) return text;
  let result = text;
  const dep = evidence.dependencyCount;
  const dept = evidence.dependentCount;

  // 0. Ensure friction score is always represented as X/100 and never X/10
  result = result.replace(/\b(\d+(?:\.\d+)?)\s*\/\s*10\b(?!\d)/g, '$1/100');

  // Grounding: sanitize unsupported probability/likelihood claims regarding friction score
  result = result.replace(/\b(?:indicate[s]?|suggest[s]?|mean[s]?)\s+a\s+(?:high|medium|low)?\s*(?:likelihood|probability)\s+of\s+requiring\s+coordination\b/gi, 'reflects its dependency impact and historical coupling');
  result = result.replace(/\b(?:high|medium|low)\s+(?:likelihood|probability)\s+of\s+(?:requiring\s+coordination|causing\s+regressions?|bugs?|failures?)\b/gi, 'elevated structural coordination need based on metrics');

  if (dep !== dept) {
    // 1. "X modules depend on this file" - only valid for dependentCount
    const modulesDependRegex = new RegExp(`\\b${dep}\\s+modules?\\s+(?:that\\s+)?depend(?:s)?\\s+on\\s+this\\s+file\\b`, 'gi');
    result = result.replace(modulesDependRegex, `${dept} module${dept === 1 ? '' : 's'} depend on this file`);

    // 2. "Coordinate with X dependent modules" -> Invalid recommendation direction, convert to inspecting dependencies
    const coordDepRegex = new RegExp(`\\b([Cc]oordinate\\s+with)\\s+${dep}\\s+dependent\\s+modules?\\b`, 'gi');
    result = result.replace(coordDepRegex, `Inspect the ${dep} dependencies this file relies on`);

    // 3. Actions directed at dependent modules (e.g. "Review the X dependent modules")
    const actionDepRegex = new RegExp(`\\b(review|check|test|verify|notify|audit)\\s+(?:the\\s+)?${dep}\\s+dependent\\s+modules?\\b`, 'gi');
    result = result.replace(actionDepRegex, (_, verb) => `${verb} the ${dept} dependent module${dept === 1 ? '' : 's'}`);

    // 4. "has X dependent modules", "relies on X dependent modules", "imports X dependent modules" -> these are dependencies
    const reliesDepRegex = new RegExp(`\\b(has|relies\\s+on|imports|contains)\\s+${dep}\\s+dependent\\s+modules?\\b`, 'gi');
    result = result.replace(reliesDepRegex, (_, verb) => `${verb} ${dep} dependencies`);

    // 5. Impact/affect on dependent modules (e.g. "affecting X dependent modules")
    const affectDepRegex = new RegExp(`\\b(affect(?:ing|ed|s)?|impact(?:ing|ed|s)?(?:\\s+on)?)\\s+(?:the\\s+)?${dep}\\s+dependent\\s+modules?\\b`, 'gi');
    result = result.replace(affectDepRegex, (_, verb) => `${verb} the ${dept} dependent module${dept === 1 ? '' : 's'}`);

    // 6. Any remaining references describing dependencyCount as dependent modules/dependents
    const remainingDepModules = new RegExp(`\\b${dep}\\s+dependent\\s+(?:modules?|files?)\\b`, 'gi');
    result = result.replace(remainingDepModules, `${dep} dependencies`);

    const remainingDependents = new RegExp(`\\b${dep}\\s+dependents\\b`, 'gi');
    result = result.replace(remainingDependents, `${dep} dependencies`);

    // 7. Misplaced claims of relying on `dept` dependencies when dept is actually dependents
    const reliesDeptRegex = new RegExp(`\\b(has|relies\\s+on|imports|contains)\\s+${dept}\\s+dependenc(?:y|ies)\\b`, 'gi');
    result = result.replace(reliesDeptRegex, (_, verb) => `${verb} ${dep} dependencies`);
  }

  return result;
}

export async function generateEngineeringBrief(evidence: FileEvidence): Promise<EngineeringBrief> {
  const risk = getRiskLevel(evidence.metrics.frictionScore);
  const coChanged = evidence.coChangedWith.slice(0, 3).join(', ') || 'none';

  const depLabel = evidence.dependencyCount === 1 ? '1 dependency' : `${evidence.dependencyCount} dependencies`;
  const depModulesLabel = evidence.dependencyCount === 1 ? '1 module' : `${evidence.dependencyCount} modules`;
  const deptLabel = evidence.dependentCount === 1 ? '1 dependent' : `${evidence.dependentCount} dependents`;
  const deptModulesLabel = evidence.dependentCount === 1 ? '1 module depends' : `${evidence.dependentCount} modules depend`;
  const deptModulesCountLabel = evidence.dependentCount === 1 ? '1 dependent module' : `${evidence.dependentCount} dependent modules`;

  const scoreFormatted = `${evidence.metrics.frictionScore.toFixed(1)}/100`;

  const prompt = `System Instructions:
Friction score is a 0-100 change-risk/friction score (higher score = more friction/risk to change). It does NOT measure code quality, maintainability, or bug likelihood.
The Change-Friction Score is a deterministic composite metric on a strict 0-100 scale.
SCORE FORMAT RULE:
- The friction score MUST ALWAYS be expressed as X/100 (e.g. "${scoreFormatted}"). NEVER write X/10 or "/10".
GROUNDING & PROBABILITY PROHIBITION:
- The score reflects structural technical evidence: dependency impact, change frequency, historical coupling, contributor spread, and historical risk.
- NEVER describe the friction score as a probability or likelihood (e.g. do NOT say "high likelihood of requiring coordination", "probability of failure", or "likely to break").
- NEVER claim the score means a file is likely to contain bugs, fail, cause regressions, or require coordination unless the evidence explicitly supports that statement.
- Use the deterministic Technical Evidence as the sole source of truth.
- Make ONLY claims directly supported by the evidence.
- Use evidence-grounded phrasing such as: "This file has a ${risk} change-friction score (${scoreFormatted}). The score reflects its dependency impact, change frequency, historical coupling, contributor spread, and historical risk."
Distinguish dependency direction precisely:
- Dependencies = modules/files that the selected file itself depends on (${evidence.dependencyCount} dependencies). Say "${depLabel}" or "${depModulesLabel} this file relies on" when referring to modules this file depends on. NEVER describe dependencyCount as dependent modules. NEVER say "${evidence.dependencyCount} modules depend on this file" unless dependentCount is actually ${evidence.dependencyCount}.
- Dependents = modules/files that depend on the selected file (${evidence.dependentCount} dependents). Say "${deptLabel}" or "${deptModulesLabel} on this file" when referring to modules affected by changes to this file.
NEVER refer to dependencies as "dependent modules". Maintain the exact counts and direction given in the evidence.
Ensure recommendations follow the same direction:
- "Review the ${deptModulesCountLabel}" is valid.
- "Inspect the ${depLabel} this file relies on" is valid.
- "Coordinate with ${evidence.dependencyCount} dependent modules" is invalid.
Do NOT invent code ownership, maintainers, or "owners of X files".
Do NOT make unsupported operational claims such as "before deploying". Keep recommendations grounded strictly in repository evidence (e.g. review dependent modules, inspect relevant co-changed files, review Git history).
Do NOT invent performance problems, bugs, security problems, architecture flaws, unidentified tests, stakeholders, unlisted dependencies, or business impacts.
Do NOT claim dependencies contain "critical functionality" unless explicitly supported by evidence. Instead suggest: "Review dependent modules to understand how changes may affect them."
When discussing regressions, prefer: "Frequent historical changes make broader regression testing advisable." Do not claim regressions actually occurred.
The listed co-changed files are only a sample subset. NEVER state or imply that the listed count is the total number of co-changed files. Use phrases like "the supplied co-changed files", "the highlighted co-changed files", or "the most relevant co-changed files provided".
Recommendations must be directly tied to the supplied metrics and numbers. Do not include unsupported recommendations.
Return concise JSON:
{"whyItMatters":"1-2 evidence-grounded sentences explaining the ${risk} change-friction score (${scoreFormatted}) based on the structural metrics","whatCouldBeAffected":["2-4 specific implications supported by the metrics"],"beforeYouChangeIt":["2-4 evidence-based actions"]}

Evidence:
File: ${evidence.path}
Change-Friction Score: ${scoreFormatted} (${risk} risk)
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

    const sanitizeText = (text: string) => enforceGrounding(text, evidence);
    const sanitizeArray = (arr: unknown, fallback: string) => {
      if (Array.isArray(arr)) {
        return arr.map((item) => sanitizeText(typeof item === 'string' ? item : String(item)));
      }
      return [sanitizeText(typeof arr === 'string' ? arr : fallback)];
    };

    return {
      whyItMatters: typeof parsed.whyItMatters === 'string'
        ? sanitizeText(parsed.whyItMatters) : 'No explanation provided.',
      whatCouldBeAffected: sanitizeArray(parsed.whatCouldBeAffected, 'No affected modules identified.'),
      beforeYouChangeIt: sanitizeArray(parsed.beforeYouChangeIt, 'Proceed with standard caution.'),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to generate engineering brief: ${error.message}`);
    }
    throw new Error('Failed to generate engineering brief: Unknown error');
  }
}
