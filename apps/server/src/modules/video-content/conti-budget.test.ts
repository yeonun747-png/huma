import { describe, expect, it } from 'vitest';
import {
  CONTI_GENERATION_BUDGET_MS,
  ContiGenerationBudgetExceeded,
  createContiGenerationBudget,
} from './conti-budget.js';

describe('createContiGenerationBudget', () => {
  it('throws when deadline exceeded', () => {
    const budget = createContiGenerationBudget(Date.now() - CONTI_GENERATION_BUDGET_MS - 1_000);
    expect(() => budget.assert()).toThrow(ContiGenerationBudgetExceeded);
  });

  it('allows calls within budget', () => {
    const budget = createContiGenerationBudget(Date.now());
    expect(() => budget.assert()).not.toThrow();
    expect(budget.remainingMs()).toBeLessThanOrEqual(CONTI_GENERATION_BUDGET_MS);
  });
});
