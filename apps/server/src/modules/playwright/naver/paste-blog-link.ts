import type { Locator, Page } from 'playwright';

import { sleep } from '../../../lib/utils.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { scaledHumanSleep } from '../../human-engine/timing.js';

/** 네이버 스마트에디터 OG 링크 카드 셀렉터 */
const OG_LINK_SELECTORS = [
  '.se-module-oglink',
  '.se-oglink-module',
  '.se-component-oglink',
  '[class*="oglink"]',
  '[data-module="oglink"]',
];

/**
 * URL Ctrl+V 붙여넣기 → 자동 하이퍼링크 + OG 미리보기 카드 대기
 * (한 글자씩 타이핑하면 OG 카드가 생성되지 않음)
 */
export async function pasteBlogLinkWithOgPreview(
  page: Page,
  editor: Locator,
  linkUrl: string,
  scale = 1,
): Promise<{ ogPreview: boolean }> {
  const frame = page.frameLocator('#mainFrame');

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await humanClickLocator(page, editor);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await scaledHumanSleep(400, 900, scale);

  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, linkUrl);
  await page.keyboard.press('Control+V');

  const deadline = Date.now() + 20_000;
  let ogPreview = false;
  while (Date.now() < deadline) {
    for (const sel of OG_LINK_SELECTORS) {
      if ((await frame.locator(sel).count()) > 0) {
        ogPreview = true;
        break;
      }
    }
    if (ogPreview) break;
    await sleep(400);
  }

  await scaledHumanSleep(1500, 3500, scale);
  return { ogPreview };
}
