import { describe, expect, it } from 'vitest';
import { calculateFileMetrics } from './score.js';

describe('analyzer metrics', () => {
  it('produces explainable metrics for a module with high friction', () => {
    const result = calculateFileMetrics({
      path: 'src/payment/paymentService.ts',
      dependencies: ['src/orders/orderService.ts', 'src/invoice/invoiceService.ts'],
      dependents: ['src/payment/checkout.ts', 'src/billing/index.ts'],
      changeCount: 47,
      contributorCount: 7,
      coChangedWith: ['src/orders/orderService.ts', 'src/invoice/invoiceService.ts'],
      history: [],
      couplingWeight: 2,
      maxMetrics: {
        dependencySum: 4,
        changeCount: 100,
        couplingWeight: 5,
        contributorCount: 10,
        riskSignals: 5,
      }
    });

    expect(result.metrics.frictionScore).toBeGreaterThan(0);
    expect(result.metrics.frictionScore).toBeLessThanOrEqual(100);
    expect(result.explanation).toContain('src/payment/paymentService.ts');
    expect(result.coChangedWith).toHaveLength(2);
  });
});
