import type { Workspace } from '@huma/shared';
import { DEFAULT_CRANK_KEYWORD_POOLS } from '@huma/shared';
import { shuffleArray } from '../../../lib/utils.js';

/** v3.28 — 서비스별 keyword_pools에서 매 세션 랜덤 선택 (고정 패턴 금지) */
export function selectCrankKeywordsForWorkspace(
  workspace: Workspace,
  pools: Partial<Record<Workspace, string[]>> | undefined,
  pickCount = 4,
): string[] {
  const pool = pools?.[workspace] ?? DEFAULT_CRANK_KEYWORD_POOLS[workspace];
  const unique = [...new Set(pool.filter(Boolean))];
  return shuffleArray(unique).slice(0, Math.min(pickCount, unique.length));
}
