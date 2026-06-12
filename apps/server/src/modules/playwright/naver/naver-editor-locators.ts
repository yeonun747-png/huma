import type { FrameLocator, Locator, Page } from 'playwright';

import { humanClickLocator } from '../../human-engine/mouse.js';

export function editorFrame(page: Page): FrameLocator {
  return page.frameLocator('#mainFrame');
}

/** 현행 SE ONE + 구형 postwrite 공통 제목 셀렉터 */
export const BLOG_TITLE_SELECTORS = [
  '#subjectTextBox',
  '#titleArea',
  '[placeholder*="제목"]',
  '[data-placeholder*="제목"]',
  '.se-title-text',
  '.se-text-input',
  '.se-documentTitle',
  '.se-section-documentTitle',
  '.se-section-documentTitle [contenteditable="true"]',
  '.se-documentTitle [contenteditable="true"]',
];

export const BLOG_BODY_SELECTORS = [
  '.se-content',
  '.se-text-paragraph',
  '.se-component-content',
  '.se-main-container',
  '.se-section-text',
  '[class*="se-section-text"]',
  '.se-placeholder',
  '[contenteditable="true"]',
];

/** iframe·페이지 양쪽에서 첫 번째 보이는 locator 탐색 */
export async function findVisibleLocator(
  page: Page,
  selectors: string[],
  options?: { inFrame?: boolean },
): Promise<Locator | null> {
  const scopes: Array<Page | FrameLocator> =
    options?.inFrame === false ? [page] : [editorFrame(page), page];

  for (const scope of scopes) {
    for (const sel of selectors) {
      const loc = scope.locator(sel).first();
      try {
        if ((await loc.count()) > 0 && (await loc.isVisible())) {
          return loc;
        }
      } catch {
        /* cross-origin frame 등 */
      }
    }
  }
  return null;
}

/** 제목란 — CSS + placeholder "제목" (현행 SE ONE 스크린샷 기준) */
export async function findBlogTitleLocator(page: Page): Promise<Locator | null> {
  const css = await findVisibleLocator(page, BLOG_TITLE_SELECTORS);
  if (css) return css;
  try {
    const ph = page.getByPlaceholder('제목').first();
    if ((await ph.count()) > 0 && (await ph.isVisible())) return ph;
  } catch {
    /* ignore */
  }
  return null;
}

/** 현행 SE ONE — #mainFrame 없이 postwrite URL + 상단 발행 버튼 */
export async function isSeOneEditorShellReady(page: Page): Promise<boolean> {
  if (!/postwrite|PostWriteForm|GoBlogWrite/i.test(page.url())) return false;
  return page
    .locator('button:has-text("발행")')
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
}

export async function isNaverBlogEditorInteractable(page: Page): Promise<boolean> {
  const onPostwrite = /postwrite|PostWriteForm|GoBlogWrite/i.test(page.url());
  const hasLegacyFrame = (await page.locator('#mainFrame').count().catch(() => 0)) > 0;
  if (!onPostwrite && !hasLegacyFrame) return false;

  if ((await findBlogTitleLocator(page)) !== null) return true;
  if ((await findVisibleLocator(page, BLOG_BODY_SELECTORS)) !== null) return true;

  if (onPostwrite && (await isSeOneEditorShellReady(page))) {
    const pageOnlyBody = await findVisibleLocator(page, BLOG_BODY_SELECTORS, { inFrame: false });
    const pageOnlyTitle = await findVisibleLocator(page, BLOG_TITLE_SELECTORS, { inFrame: false });
    return pageOnlyBody !== null || pageOnlyTitle !== null;
  }

  return false;
}

export async function clickVisibleLocator(page: Page, loc: Locator): Promise<void> {
  await humanClickLocator(page, loc);
}

/** 스마트에디터 툴바 버튼 — data-name → aria → 텍스트 순 */
export async function clickEditorToolbar(
  page: Page,
  options: {
    dataNames?: string[];
    ariaLabels?: string[];
    buttonTexts?: string[];
    classHints?: string[];
  },
): Promise<boolean> {
  const { dataNames = [], ariaLabels = [], buttonTexts = [], classHints = [] } = options;

  for (const name of dataNames) {
    const loc = await findVisibleLocator(page, [`[data-name="${name}"]`, `[data-log="${name}"]`]);
    if (loc) {
      await clickVisibleLocator(page, loc);
      return true;
    }
  }

  for (const hint of classHints) {
    const loc = await findVisibleLocator(page, [`[class*="${hint}"]`]);
    if (loc) {
      await clickVisibleLocator(page, loc);
      return true;
    }
  }

  const frame = editorFrame(page);
  for (const label of ariaLabels) {
    for (const scope of [frame, page]) {
      const loc = scope.getByRole('button', { name: label }).first();
      try {
        if ((await loc.count()) > 0 && (await loc.isVisible())) {
          await clickVisibleLocator(page, loc);
          return true;
        }
      } catch {
        /* ignore */
      }
    }
  }

  for (const text of buttonTexts) {
    for (const scope of [frame, page]) {
      const loc = scope.locator(`button:has-text("${text}")`).first();
      try {
        if ((await loc.count()) > 0 && (await loc.isVisible())) {
          await clickVisibleLocator(page, loc);
          return true;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return false;
}
