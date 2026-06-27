import type { BrowserContext } from 'playwright';

import { applyNaverResourceBlocking } from './naver-resource-block.js';

/** v3.25+ — crank·워밍업·본 세션 데이터 절약 */
export async function applyCrankResourceBlocking(context: BrowserContext): Promise<void> {
  await applyNaverResourceBlocking(context, 'workflow');
}
