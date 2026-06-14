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
  insertTextIntoInputLocator,
  isFocusInTitleArea,
  resolveBodyEditableLocator,
} from './naver-editor-locators.js';

const BODY_SECTION =
  '.se-components-wrap .se-section-text:not(.se-section-documentTitle)';

const OG_LINK_SELECTORS = [
  '.se-module-oglink',
  '.se-oglink-module',
  '.se-component-oglink',
  '[class*="oglink"]',
  '[data-module="oglink"]',
];

export async function isOgLinkInBodySection(page: Page): Promise<boolean> {
  for (const sel of OG_LINK_SELECTORS) {
    const scoped = `${BODY_SECTION} ${sel}`;
    if ((await page.locator(scoped).count()) > 0) return true;
  }
  return false;
}

/** @deprecated 툴바 oglink 버튼 오탐 — isOgLinkInBodySection / isBlogLinkUrlInBodyText 사용 */
export async function isOgLinkVisible(page: Page): Promise<boolean> {
  return isOgLinkInBodySection(page);
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
    /** blog-editor에서 본문 끝 Enter×2 후 — 캐럿 이동·줄바꿈 생략 */
    atCaret?: boolean;
  },
): Promise<{ ogPreview: boolean }> {
  const scale = options.scale ?? 1;
  const workspace = options.workspace ?? 'yeonun';
  const insertUrl = resolveBlogLinkUrl(workspace, linkUrl, linkUrl);

  if (!options.atCaret) {
    await blurBlogTitleField(page);
    const editable = await resolveBodyEditableLocator(editor);
    await humanClickLocator(page, editable);
    await sleep(200);
    if (await isFocusInTitleArea(page)) {
      throw new Error('BLOG_BODY_INSERTED_INTO_TITLE');
    }
    await page.keyboard.press('Control+End');
    await sleep(120);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await sleep(200);
  }

  if (workspace === 'yeonun') {
    await page.keyboard.insertText(insertUrl);
  } else {
    const toolbarLinked = await insertLinkViaToolbar(page, insertUrl, scale);
    if (!toolbarLinked) {
      await page.keyboard.insertText(insertUrl);
    }
  }

  const deadline = Date.now() + 20_000;
  let ogPreview = false;
  while (Date.now() < deadline) {
    if (await isOgLinkInBodySection(page)) {
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
