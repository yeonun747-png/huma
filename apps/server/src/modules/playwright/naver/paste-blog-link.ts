import type { Locator, Page } from 'playwright';

import { sleep } from '../../../lib/utils.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { scaledHumanSleep } from '../../human-engine/timing.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import { resolveBlogLinkUrl } from '../../../lib/blog-link.js';
import {
  blurBlogTitleField,
  clickEditorToolbar,
  findVisibleLocator,
  focusBlogBodyField,
  insertParagraphBreakInBlogEditable,
  insertTextIntoBlogEditable,
  insertTextIntoInputLocator,
  resolveBodyEditableLocator,
} from './naver-editor-locators.js';

const OG_LINK_SELECTORS = [
  '.se-module-oglink',
  '.se-oglink-module',
  '.se-component-oglink',
  '[class*="oglink"]',
  '[data-module="oglink"]',
];

async function isOgLinkVisible(page: Page): Promise<boolean> {
  for (const sel of OG_LINK_SELECTORS) {
    if ((await page.locator(sel).count()) > 0) return true;
    if ((await page.frameLocator('#mainFrame').locator(sel).count().catch(() => 0)) > 0) return true;
  }
  return false;
}

/**
 * 링크 삽입
 * - 연운: 본문 locator 직접 붙여넣기 → OG 카드
 * - 그 외: 툴바 「링크」 → URL 입력 → 확인 (실패 시 직접 insert 폴백)
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

  await blurBlogTitleField(page);
  await focusBlogBodyField(page, editor);
  const editable = await resolveBodyEditableLocator(editor);
  await insertParagraphBreakInBlogEditable(editable, 2);
  await scaledHumanSleep(400, 900, scale);

  if (workspace === 'yeonun') {
    await insertTextIntoBlogEditable(editable, insertUrl);
  } else {
    const toolbarLinked = await insertLinkViaToolbar(page, insertUrl, scale);
    if (!toolbarLinked) {
      await insertTextIntoBlogEditable(editable, insertUrl);
    }
  }

  const deadline = Date.now() + 20_000;
  let ogPreview = false;
  while (Date.now() < deadline) {
    if (await isOgLinkVisible(page)) {
      ogPreview = true;
      break;
    }
    await sleep(400);
  }

  await scaledHumanSleep(1500, 3500, scale);
  return { ogPreview };
}

async function insertLinkViaToolbar(
  page: Page,
  linkUrl: string,
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
  await insertTextIntoInputLocator(input, linkUrl);
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

  await input.press('Enter');
  await scaledHumanSleep(800, 1600, scale);
  return true;
}
