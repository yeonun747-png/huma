import type { Locator, Page } from 'playwright';

import { sleep } from '../../../lib/utils.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { humanType } from '../../human-engine/typing.js';
import { scaledHumanSleep } from '../../human-engine/timing.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';

const YEONUN_PLAIN_LINK = 'yeonun.com';

/** 네이버 스마트에디터 OG 링크 카드 셀렉터 (연운 외 workspace) */
const OG_LINK_SELECTORS = [
  '.se-module-oglink',
  '.se-oglink-module',
  '.se-component-oglink',
  '[class*="oglink"]',
  '[data-module="oglink"]',
];

function isYeonunPlainLink(workspace: string, linkUrl: string): boolean {
  if (workspace === 'yeonun') return true;
  const t = linkUrl.trim().toLowerCase();
  return t === 'yeonun.com' || t === 'www.yeonun.com';
}

/**
 * 연운: yeonun.com 텍스트 타이핑 (OG 카드 없음)
 * 그 외: URL Ctrl+V → 하이퍼링크 + OG 미리보기 대기
 */
export async function pasteBlogLinkWithOgPreview(
  page: Page,
  editor: Locator,
  linkUrl: string,
  options: {
    workspace?: string;
    scale?: number;
    humanConfig: HumanEngineConfig;
  },
): Promise<{ ogPreview: boolean }> {
  const scale = options.scale ?? 1;
  const workspace = options.workspace ?? 'yeonun';

  if (isYeonunPlainLink(workspace, linkUrl)) {
    await humanClickLocator(page, editor);
    await humanType(page, editor, `\n\n${YEONUN_PLAIN_LINK}`, options.humanConfig);
    await scaledHumanSleep(800, 1800, scale);
    return { ogPreview: false };
  }

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
