import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateEngineeringBrief } from './brief.js';
import * as ollama from './ollama.js';

const makeEvidence = (overrides = {}) => ({
  path: 'src/index.ts',
  metrics: {
    dependencyImpact: 80,
    changeFrequency: 90,
    coChangeCoupling: 70,
    contributorComplexity: 50,
    historicalRisk: 60,
    frictionScore: 85
  },
  dependencyCount: 5,
  dependentCount: 10,
  changeCount: 100,
  contributorCount: 5,
  coChangedWith: ['src/utils.ts', 'src/config.ts'],
  historicalEvidence: [],
  ...overrides,
});

describe('generateEngineeringBrief', () => {
  beforeEach(() => {
    vi.spyOn(ollama, 'generateText');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a parsed engineering brief with array outputs', async () => {
    vi.mocked(ollama.generateText).mockResolvedValueOnce(JSON.stringify({
      whyItMatters: 'It matters.',
      whatCouldBeAffected: ['Auth module', 'Config loader'],
      beforeYouChangeIt: ['Run tests', 'Check dependents']
    }));

    const brief = await generateEngineeringBrief(makeEvidence());

    expect(brief).toEqual({
      whyItMatters: 'It matters.',
      whatCouldBeAffected: ['Auth module', 'Config loader'],
      beforeYouChangeIt: ['Run tests', 'Check dependents']
    });

    // Verify JSON mode and speed options are passed
    expect(ollama.generateText).toHaveBeenCalledWith(
      expect.stringContaining('src/index.ts'),
      { json: true, numPredict: 256, numCtx: 1024 }
    );
  });

  it('includes risk level and evidence in prompt', async () => {
    vi.mocked(ollama.generateText).mockResolvedValueOnce(JSON.stringify({
      whyItMatters: 'Risk.',
      whatCouldBeAffected: ['X'],
      beforeYouChangeIt: ['Y']
    }));

    await generateEngineeringBrief(makeEvidence());

    const call = vi.mocked(ollama.generateText).mock.calls[0][0];
    expect(call).toContain('HIGH');
    expect(call).toContain('Dependents (modules depending on this file): 10');
    expect(call).toContain('src/utils.ts');
    expect(call).toContain('Do NOT invent');
  });

  it('coerces string values to arrays for affected/actions', async () => {
    vi.mocked(ollama.generateText).mockResolvedValueOnce(JSON.stringify({
      whyItMatters: 'It matters.',
      whatCouldBeAffected: 'Everything breaks',
      beforeYouChangeIt: 'Check tests'
    }));

    const brief = await generateEngineeringBrief(makeEvidence());

    expect(Array.isArray(brief.whatCouldBeAffected)).toBe(true);
    expect(Array.isArray(brief.beforeYouChangeIt)).toBe(true);
    expect(brief.whatCouldBeAffected).toEqual(['Everything breaks']);
    expect(brief.beforeYouChangeIt).toEqual(['Check tests']);
  });

  it('handles JSON parsing failures gracefully', async () => {
    vi.mocked(ollama.generateText).mockResolvedValueOnce('Not JSON');

    await expect(generateEngineeringBrief(makeEvidence())).rejects.toThrow(
      /Failed to generate engineering brief/
    );
  });

  it('defines friction score as change risk/friction (not quality) in prompt', async () => {
    vi.mocked(ollama.generateText).mockResolvedValueOnce(JSON.stringify({
      whyItMatters: 'Risk.',
      whatCouldBeAffected: ['X'],
      beforeYouChangeIt: ['Y']
    }));

    await generateEngineeringBrief(makeEvidence());

    const call = vi.mocked(ollama.generateText).mock.calls[0][0];
    expect(call).toContain('Friction score is a 0-100 change-risk/friction score');
    expect(call).toContain('It does NOT measure code quality');
  });

  it('prohibits inventing performance, security, bugs, or unsupported claims in prompt', async () => {
    vi.mocked(ollama.generateText).mockResolvedValueOnce(JSON.stringify({
      whyItMatters: 'Risk.',
      whatCouldBeAffected: ['X'],
      beforeYouChangeIt: ['Y']
    }));

    await generateEngineeringBrief(makeEvidence());

    const call = vi.mocked(ollama.generateText).mock.calls[0][0];
    expect(call).toContain('Do NOT invent performance problems, bugs, security problems');
    expect(call).toContain('Make ONLY claims directly supported by the evidence');
    expect(call).toContain('Recommendations must be directly tied to the supplied metrics');
  });

  it('instructs model that listed co-changed files are a sample subset and prohibits total-count claims', async () => {
    vi.mocked(ollama.generateText).mockResolvedValueOnce(JSON.stringify({
      whyItMatters: 'Risk.',
      whatCouldBeAffected: ['X'],
      beforeYouChangeIt: ['Y']
    }));

    await generateEngineeringBrief(makeEvidence());

    const call = vi.mocked(ollama.generateText).mock.calls[0][0];
    expect(call).toContain('sample subset');
    expect(call).toContain('NEVER state or imply that the listed count is the total number of co-changed files');
    expect(call).toContain('the supplied co-changed files');
  });

  it('prohibits claiming critical functionality without evidence and enforces grounded regression phrasing', async () => {
    vi.mocked(ollama.generateText).mockResolvedValueOnce(JSON.stringify({
      whyItMatters: 'Risk.',
      whatCouldBeAffected: ['X'],
      beforeYouChangeIt: ['Y']
    }));

    await generateEngineeringBrief(makeEvidence());

    const call = vi.mocked(ollama.generateText).mock.calls[0][0];
    expect(call).toContain('Do NOT claim dependencies contain "critical functionality"');
    expect(call).toContain('Review dependent modules to understand how changes may affect them');
    expect(call).toContain('Frequent historical changes make broader regression testing advisable');
  });

  it('enforces precise dependency direction distinction in prompt', async () => {
    vi.mocked(ollama.generateText).mockResolvedValueOnce(JSON.stringify({
      whyItMatters: 'Risk.',
      whatCouldBeAffected: ['X'],
      beforeYouChangeIt: ['Y']
    }));

    await generateEngineeringBrief(makeEvidence({ dependencyCount: 22, dependentCount: 2 }));

    const call = vi.mocked(ollama.generateText).mock.calls[0][0];
    expect(call).toContain('Distinguish dependency direction precisely');
    expect(call).toContain('NEVER refer to dependencies as "dependent modules"');
    expect(call).toContain('Dependents (modules depending on this file): 2');
    expect(call).toContain('Dependencies (modules this file depends on): 22');
  });

  it('prohibits invented ownership information and unsupported operational claims', async () => {
    vi.mocked(ollama.generateText).mockResolvedValueOnce(JSON.stringify({
      whyItMatters: 'Risk.',
      whatCouldBeAffected: ['X'],
      beforeYouChangeIt: ['Y']
    }));

    await generateEngineeringBrief(makeEvidence());

    const call = vi.mocked(ollama.generateText).mock.calls[0][0];
    expect(call).toContain('Do NOT invent code ownership, maintainers, or "owners of X files"');
    expect(call).toContain('Do NOT make unsupported operational claims such as "before deploying"');
  });

  it('regression test: enforces strict terminology and grounding for dependencyCount=22 and dependentCount=2', async () => {
    const evidence = makeEvidence({ dependencyCount: 22, dependentCount: 2 });

    // Mock LLM output containing the exact contradictions and invalid terminology described in the problem
    vi.mocked(ollama.generateText).mockResolvedValueOnce(JSON.stringify({
      whyItMatters: 'This file has 22 dependent modules. Changes to this file pose risk because 22 modules depend on this file.',
      whatCouldBeAffected: [
        'Affecting 22 dependent modules throughout the project',
        '2 modules depend on this file directly'
      ],
      beforeYouChangeIt: [
        'Coordinate with 22 dependent modules',
        'Review the 22 dependent modules',
        'Inspect the 22 dependencies this file relies on',
        'Review the 2 dependent modules'
      ]
    }));

    const brief = await generateEngineeringBrief(evidence);

    // 1. Verify Prompt Enforcement
    const promptCall = vi.mocked(ollama.generateText).mock.calls[0][0];
    expect(promptCall).toContain('Dependencies = modules/files that the selected file itself depends on (22 dependencies)');
    expect(promptCall).toContain('Dependents = modules/files that depend on the selected file (2 dependents)');
    expect(promptCall).toContain('Say "22 dependencies"');
    expect(promptCall).toContain('Say "2 dependents" or "2 modules depend on this file"');
    expect(promptCall).toContain('NEVER describe dependencyCount as dependent modules');
    expect(promptCall).toContain('NEVER say "22 modules depend on this file" unless dependentCount is actually 22');
    expect(promptCall).toContain('"Review the 2 dependent modules" is valid');
    expect(promptCall).toContain('"Inspect the 22 dependencies this file relies on" is valid');
    expect(promptCall).toContain('"Coordinate with 22 dependent modules" is invalid');
    expect(promptCall).toContain('Dependents (modules depending on this file): 2');
    expect(promptCall).toContain('Dependencies (modules this file depends on): 22');

    // 2. Verify Output Grounding / Terminology Enforcement
    // NEVER describe dependencyCount (22) as dependent modules
    expect(brief.whyItMatters).not.toContain('22 dependent modules');
    expect(brief.whyItMatters).not.toContain('22 modules depend on this file');
    // Say "22 dependencies" when referring to modules this file depends on
    expect(brief.whyItMatters).toContain('22 dependencies');
    // Say "2 modules depend on this file" when referring to modules affected by changes
    expect(brief.whyItMatters).toContain('2 modules depend on this file');

    // What could be affected
    expect(brief.whatCouldBeAffected[0]).not.toContain('22 dependent modules');
    expect(brief.whatCouldBeAffected[0]).toContain('the 2 dependent modules');
    expect(brief.whatCouldBeAffected[1]).toContain('2 modules depend on this file');

    // Recommendations direction
    // "Coordinate with 22 dependent modules" is invalid and corrected
    expect(brief.beforeYouChangeIt[0]).not.toContain('Coordinate with 22 dependent modules');
    expect(brief.beforeYouChangeIt[0]).toContain('Inspect the 22 dependencies this file relies on');

    // "Review the 22 dependent modules" is corrected to 2 dependent modules
    expect(brief.beforeYouChangeIt[1]).not.toContain('22 dependent modules');
    expect(brief.beforeYouChangeIt[1]).toContain('Review the 2 dependent modules');

    // Valid recommendations preserved
    expect(brief.beforeYouChangeIt[2]).toBe('Inspect the 22 dependencies this file relies on');
    expect(brief.beforeYouChangeIt[3]).toBe('Review the 2 dependent modules');
  });

  it('regression test: enforces X/100 score format and replaces X/10 and probability claims', async () => {
    const evidence = makeEvidence({
      metrics: {
        dependencyImpact: 75,
        changeFrequency: 80,
        coChangeCoupling: 85,
        contributorComplexity: 70,
        historicalRisk: 80,
        frictionScore: 80.25,
      },
      dependencyCount: 14,
      dependentCount: 2,
    });

    vi.mocked(ollama.generateText).mockResolvedValueOnce(JSON.stringify({
      whyItMatters: 'This file has a HIGH change-friction score (80.3/10: 2 dependents and 14 dependencies indicate a high likelihood of requiring coordination...)',
      whatCouldBeAffected: [
        'Affecting modules with high probability of causing regressions',
        'Files that depend on this one at 80.3/10 score'
      ],
      beforeYouChangeIt: [
        'High likelihood of requiring coordination across teams',
        'Review the 2 dependent modules'
      ]
    }));

    const brief = await generateEngineeringBrief(evidence);

    // Verify prompt instructions
    const promptCall = vi.mocked(ollama.generateText).mock.calls[0][0];
    expect(promptCall).toContain('The friction score MUST ALWAYS be expressed as X/100 (e.g. "80.3/100"). NEVER write X/10 or "/10".');
    expect(promptCall).toContain('NEVER describe the friction score as a probability or likelihood');
    expect(promptCall).toContain('NEVER claim the score means a file is likely to contain bugs, fail, cause regressions, or require coordination');

    // Verify whyItMatters never produces /10
    expect(brief.whyItMatters).not.toContain('/10:');
    expect(brief.whyItMatters).not.toContain('/10 ');
    expect(brief.whyItMatters).not.toMatch(/\b\d+(\.\d+)?\/10\b/);
    expect(brief.whyItMatters).toContain('80.3/100');

    // Verify probability/likelihood claims are sanitized
    expect(brief.whyItMatters).not.toContain('indicate a high likelihood of requiring coordination');
    expect(brief.whatCouldBeAffected[0]).not.toContain('high probability of causing regressions');
    expect(brief.whatCouldBeAffected[1]).not.toMatch(/\b80\.3\/10\b/);
    expect(brief.whatCouldBeAffected[1]).toContain('80.3/100');
    expect(brief.beforeYouChangeIt[0]).not.toContain('High likelihood of requiring coordination');
  });
});


