import type { BrowserContext } from 'playwright';

import { applyNaverResourceBlocking } from './naver-resource-block.js';

/** C-Rank·워밍업·본 세션 — 원격접속과 동일 데이터 절약 규칙 */
export async function applyCrankResourceBlocking(context: BrowserContext): Promise<void> {
  await applyNaverResourceBlocking(context);
}
