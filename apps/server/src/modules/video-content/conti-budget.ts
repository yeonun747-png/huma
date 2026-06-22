/** 콘티 생성 wall-clock 상한 (P0) */
export const CONTI_GENERATION_BUDGET_MS = 180_000;

export class ContiGenerationBudgetExceeded extends Error {
  constructor(elapsedSec: number) {
    super(`콘티 생성 시간 예산 초과 (${elapsedSec}초 / ${CONTI_GENERATION_BUDGET_MS / 1000}초)`);
    this.name = 'ContiGenerationBudgetExceeded';
  }
}

export function createContiGenerationBudget(startedAtMs = Date.now()) {
  const deadlineMs = startedAtMs + CONTI_GENERATION_BUDGET_MS;
  return {
    deadlineMs,
    elapsedSec: () => Math.max(0, Math.round((Date.now() - startedAtMs) / 1000)),
    remainingMs: () => Math.max(0, deadlineMs - Date.now()),
    assert: () => {
      if (Date.now() > deadlineMs) {
        throw new ContiGenerationBudgetExceeded(Math.round((Date.now() - startedAtMs) / 1000));
      }
    },
  };
}
