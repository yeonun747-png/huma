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
  '.se-section-text [contenteditable="true"]',
  '.se-text-paragraph[contenteditable="true"]',
  '.se-content',
  '.se-text-paragraph',
  '.se-component-content',
  '.se-main-container',
  '.se-section-text',
  '[class*="se-section-text"]',
  '.se-placeholder',
];

/** 임시저장 이어쓰기 팝업 — 취소 전에는 에디터 입력 금지 */
export async function isDraftResumePopupVisible(page: Page): Promise<boolean> {
  const patterns = [
    page.locator('text=작성 중인 글이 있습니다').first(),
    page.locator('text=작성중인 글이 있습니다').first(),
    page.getByText(/작성\s*중인\s*글이/).first(),
    page.locator('[class*="se-popup"]').filter({ hasText: '작성 중인 글이 있습니다' }).first(),
  ];
  for (const loc of patterns) {
    if (await loc.isVisible({ timeout: 200 }).catch(() => false)) return true;
  }
  return false;
}

/** 제목란 — SE ONE placeholder "제목" 우선 */
export async function findBlogTitleLocator(page: Page): Promise<Locator | null> {
  try {
    const ph = page.getByPlaceholder('제목').first();
    if ((await ph.count()) > 0 && (await ph.isVisible({ timeout: 800 }).catch(() => false))) {
      return ph;
    }
  } catch {
    /* ignore */
  }

  const titleOnly = [
    '.se-section-documentTitle [contenteditable="true"]',
    '.se-documentTitle [contenteditable="true"]',
    '.se-documentTitle',
    '.se-section-documentTitle',
    '#subjectTextBox',
    '#titleArea',
    '.se-title-text',
  ];
  const css = await findVisibleLocator(page, titleOnly, { inFrame: false });
  if (css) return css;

  return findVisibleLocator(page, BLOG_TITLE_SELECTORS);
}

/** 본문란 — 제목·documentTitle 제외 */
export async function findBlogBodyLocator(page: Page): Promise<Locator | null> {
  try {
    const ph = page.getByPlaceholder(/본문|일상/).first();
    if ((await ph.count()) > 0 && (await ph.isVisible({ timeout: 800 }).catch(() => false))) {
      return ph;
    }
  } catch {
    /* ignore */
  }

  const body = await findVisibleLocator(page, BLOG_BODY_SELECTORS, { inFrame: false });
  if (body) return body;

  const legacy = await findVisibleLocator(page, BLOG_BODY_SELECTORS);
  if (legacy) return legacy;

  if ((await page.locator('#mainFrame').count().catch(() => 0)) > 0) {
    return page
      .frameLocator('#mainFrame')
      .locator('.se-content, .se-text-paragraph, [contenteditable="true"]')
      .first();
  }

  return null;
}

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
  if (await isDraftResumePopupVisible(page)) return false;

  const onPostwrite = /postwrite|PostWriteForm|GoBlogWrite/i.test(page.url());
  const hasLegacyFrame = (await page.locator('#mainFrame').count().catch(() => 0)) > 0;
  if (!onPostwrite && !hasLegacyFrame) return false;

  if ((await findBlogTitleLocator(page)) !== null) return true;
  if ((await findBlogBodyLocator(page)) !== null) return true;

  if (onPostwrite && (await isSeOneEditorShellReady(page))) {
    return (await findBlogBodyLocator(page)) !== null || (await findBlogTitleLocator(page)) !== null;
  }

  return false;
}

export async function clickVisibleLocator(page: Page, loc: Locator): Promise<void> {
  await humanClickLocator(page, loc);
}

/** 취소선·선택 블록 등 서식 잔여 해제 — 툴바 「취소」와 혼동 금지 */
export async function clearSeOneEditorFormatting(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  const strikeOn = page
    .locator(
      '[data-name="strike"].se-is-selected, [data-name="strike"][aria-pressed="true"], button[aria-label*="취소선"].se-is-selected',
    )
    .first();
  if (await strikeOn.isVisible({ timeout: 400 }).catch(() => false)) {
    await humanClickLocator(page, strikeOn).catch(() => {});
  }
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
