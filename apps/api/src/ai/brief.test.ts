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
});
