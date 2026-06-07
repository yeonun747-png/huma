import type { Locator, Page } from 'playwright';

import { sleep } from '../../../lib/utils.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { humanPasteIntoElement, humanTypeIntoElement } from '../../human-engine/korean-ime.js';
import { scaledHumanSleep } from '../../human-engine/timing.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import { resolveBlogLinkUrl } from '../../../lib/blog-link.js';
import { clickEditorToolbar, findVisibleLocator } from './naver-editor-locators.js';

/** 네이버 스마트에디터 OG 링크 카드 셀렉터 */
const OG_LINK_SELECTORS = [
  '.se-module-oglink',
  '.se-oglink-module',
  '.se-component-oglink',
  '[class*="oglink"]',
  '[data-module="oglink"]',
];

/**
 * 링크 삽입
 * - 연운: 본문 Ctrl+V 붙여넣기 → OG 카드 (클릭 유도)
 * - 그 외: 툴바 「링크」 → URL 입력 → 확인 (실패 시 Ctrl+V 폴백)
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
  const insertUrl = resolveBlogLinkUrl(workspace, linkUrl, linkUrl);

  await humanClickLocator(page, editor);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await scaledHumanSleep(400, 900, scale);

  if (workspace === 'yeonun') {
    await humanPasteIntoElement(page, editor, insertUrl);
  } else {
    const toolbarLinked = await insertLinkViaToolbar(page, insertUrl, options.humanConfig, scale);
    if (!toolbarLinked) {
      await humanPasteIntoElement(page, editor, insertUrl);
    }
  }

  const frame = page.frameLocator('#mainFrame');
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

/** 툴바 「링크」 → URL 입력 → 확인 (OG 없는 본문 링크용 · 연운 제외) */
async function insertLinkViaToolbar(
  page: Page,
  linkUrl: string,
  humanConfig: HumanEngineConfig,
  scale: number,
): Promise<boolean> {
  const clicked = await clickEditorToolbar(page, {
    dataNames: ['oglink', 'link', 'url'],
    classHints: ['oglink', 'link-toolbar'],
    ariaLabels: ['링크', 'URL'],
    buttonTexts: ['링크', 'URL'],
  });
  if (!clicked) return false;

  await scaledHumanSleep(500, 1100, scale);

  const inputSelectors = [
    'input[placeholder*="URL"]',
    'input[placeholder*="링크"]',
    'input[type="url"]',
    '[class*="oglink"] input',
    '[class*="link"] input[type="text"]',
  ];

  const input = await findVisibleLocator(page, inputSelectors);
  if (!input) {
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }

  await humanClickLocator(page, input);
  await humanTypeIntoElement(page, input, linkUrl, humanConfig, { skipFocus: true });
  await scaledHumanSleep(400, 900, scale);

  const confirmSelectors = [
    'button:has-text("확인")',
    'button:has-text("적용")',
    'button:has-text("삽입")',
    '[class*="oglink"] button.confirm',
  ];
  const confirm = await findVisibleLocator(page, confirmSelectors);
  if (confirm) {
    await humanClickLocator(page, confirm);
    await scaledHumanSleep(800, 1600, scale);
    return true;
  }

  await page.keyboard.press('Enter');
  await scaledHumanSleep(800, 1600, scale);
  return true;
}
