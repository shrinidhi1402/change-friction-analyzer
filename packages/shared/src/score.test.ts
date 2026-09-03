import { describe, expect, it } from 'vitest';
import { calculateFrictionScore, clampScore } from './index.js';

describe('scoring calculations', () => {
  it('calculates the weighted score with the required formula', () => {
    const metrics = {
      dependencyImpact: 92,
      changeFrequency: 91,
      coChangeCoupling: 84,
      contributorComplexity: 71,
      historicalRisk: 79
    };

    expect(calculateFrictionScore(metrics)).toBe(87);
  });

  it('clamps the value between 0 and 100', () => {
    expect(clampScore(150)).toBe(100);
    expect(clampScore(-10)).toBe(0);
    expect(clampScore(42)).toBe(42);
  });
});
