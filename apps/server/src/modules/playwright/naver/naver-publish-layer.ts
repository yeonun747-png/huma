import type { Page } from 'playwright';

import { sleep } from '../../../lib/utils.js';

export const PUBLISH_LAYER_SELECTORS = [
  '[class*="publish_layer"]',
  '[class*="PublishLayer"]',
  '.se-popup-publish',
  '[class*="layer_publish"]',
  '.publish_popup',
];

/** 발행 설정 레이어(카테고리·태그) — Escape·글감 닫기 대상에서 제외 */
export async function isPublishLayerVisible(page: Page): Promise<boolean> {
  for (const sel of PUBLISH_LAYER_SELECTORS) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      return true;
    }
  }
  return false;
}

export async function waitForPublishLayer(page: Page, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPublishLayerVisible(page)) return true;
    await sleep(300);
  }
  return false;
}
