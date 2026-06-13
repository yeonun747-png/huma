import type { FrameLocator, Locator, Page } from 'playwright';

import { humanClickLocator, humanMouseMove } from '../../human-engine/mouse.js';
import { sleep } from '../../../lib/utils.js';

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

/** 제목 섹션(.se-section-documentTitle) 밖 본문만 — 제목·본문 셀렉터 겹침 방지 */
export const BLOG_BODY_SELECTORS = [
  '.se-components-wrap .se-section-text .se-text-paragraph[contenteditable="true"]',
  '.se-section-text:not(.se-section-documentTitle) .se-text-paragraph[contenteditable="true"]',
  '.se-section-text:not(.se-section-documentTitle) [contenteditable="true"]',
  '.se-section-text [contenteditable="true"]',
  '.se-text-paragraph[contenteditable="true"]',
  '.se-content',
  '.se-text-paragraph',
  '.se-component-content',
  '.se-main-container',
  '.se-section-text',
  '[class*="se-section-text"]',
];

const TITLE_SECTION_SELECTOR =
  '.se-section-documentTitle, .se-documentTitle, [data-placeholder*="제목"], .se-title-text';

const BODY_SECTION_SELECTOR =
  '.se-section-text, .se-text-paragraph, .se-content, .se-main-container, .se-components-wrap';

const TITLE_PLACEHOLDER_RE = /^(제목|title)$/i;

/** 임시저장 이어쓰기 팝업 — 취소 전에는 에디터 입력 금지 */
export async function isDraftResumePopupVisible(page: Page): Promise<boolean> {
  const patterns = [
    page.locator('text=작성 중인 글이 있습니다').first(),
    page.locator('text=작성중인 글이 있습니다').first(),
    page.getByText(/작성\s*중인\s*글이/).first(),
    page.locator('[class*="se-popup"]').filter({ hasText: '작성 중인 글이 있습니다' }).first(),
    page.locator('[class*="se-popup"]').filter({ hasText: /작성\s*중인\s*글/ }).first(),
    page
      .locator('[class*="se-popup"]')
      .filter({ hasText: /작성\s*중인\s*글/ })
      .locator('xpath=ancestor-or-self::*[contains(@class,"se-popup")][1]')
      .first(),
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

async function isLocatorInTitleSection(loc: Locator): Promise<boolean> {
  return loc
    .evaluate((el, sel) => !!el.closest(sel), TITLE_SECTION_SELECTOR)
    .catch(() => false);
}

async function isLocatorInEditorChrome(loc: Locator): Promise<boolean> {
  return loc
    .evaluate((el) => {
      if (
        el.closest(
          'button, [role="button"], [class*="floating"], [class*="dock"], [class*="toolbar"], [class*="material-kit"], .se-sidebar, .se-help-panel',
        )
      ) {
        return true;
      }
      const tag = el.tagName.toLowerCase();
      if (tag === 'button' || el.getAttribute('role') === 'button') return true;
      return false;
    })
    .catch(() => false);
}

/** 제목 바로 아래 본문 — 하단 글감 독·툴바 제외 */
async function isLocatorMainEditorBody(page: Page, loc: Locator): Promise<boolean> {
  if (await isLocatorInTitleSection(loc)) return false;
  if (await isLocatorInEditorChrome(loc)) return false;

  const box = await loc.boundingBox().catch(() => null);
  if (!box || box.height < 16 || box.width < 80) return false;

  const vp = page.viewportSize();
  if (vp && box.y > vp.height * 0.82) return false;

  return loc
    .evaluate((el) => {
      const editable =
        el.matches('[contenteditable="true"]') || !!el.querySelector('[contenteditable="true"]');
      if (!editable) return false;
      const ph = (el.textContent ?? '').trim();
      if (ph === '글감' && el.closest('[class*="floating"], [class*="dock"], [class*="toolbar"]')) {
        return false;
      }
      return true;
    })
    .catch(() => false);
}

/** 본문 섹션(placeholder만 있고 paragraph 미생성) */
async function isLocatorBodySection(page: Page, loc: Locator): Promise<boolean> {
  if (await isLocatorInTitleSection(loc)) return false;
  if (await isLocatorInEditorChrome(loc)) return false;

  const box = await loc.boundingBox().catch(() => null);
  if (!box || box.height < 28 || box.width < 80) return false;

  const vp = page.viewportSize();
  if (vp && box.y > vp.height * 0.85) return false;

  return loc
    .evaluate((el) => {
      if (el.closest('.se-section-documentTitle, .se-documentTitle')) return false;
      return !!el.closest('.se-section-text, .se-components-wrap');
    })
    .catch(() => false);
}

/** 글감 검색 팝업 — 본문 포커스 전 닫기 */
export async function dismissSeOneMaterialPopup(page: Page): Promise<void> {
  const popup = page
    .locator('[class*="se-popup"], [class*="popup"]')
    .filter({ hasText: /검색 결과가 없습니다|글감/ })
    .first();
  if (await popup.isVisible({ timeout: 250 }).catch(() => false)) {
    const closeBtn = popup
      .locator('button[aria-label*="닫"], .btn_close, button:has-text("닫기")')
      .first();
    if (await closeBtn.isVisible({ timeout: 200 }).catch(() => false)) {
      await closeBtn.click({ timeout: 3000 }).catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await sleep(200);
  }
}

async function pickMainBodyParagraph(page: Page, scope: Page | FrameLocator): Promise<Locator | null> {
  const candidates = scope.locator(
    '.se-components-wrap .se-section-text .se-text-paragraph[contenteditable="true"], .se-section-text:not(.se-section-documentTitle) .se-text-paragraph[contenteditable="true"]',
  );
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const loc = candidates.nth(i);
    if (!(await loc.isVisible({ timeout: 400 }).catch(() => false))) continue;
    if (await isLocatorMainEditorBody(page, loc)) return loc;
  }
  return null;
}

/** 본문란 — 제목·documentTitle·하단 글감 독 제외 */
export async function findBlogBodyLocator(page: Page): Promise<Locator | null> {
  await dismissSeOneMaterialPopup(page);

  try {
    const ph = page.getByPlaceholder(/본문|일상을 기록|나의 일상/).first();
    if ((await ph.count()) > 0 && (await ph.isVisible({ timeout: 800 }).catch(() => false))) {
      if (await isLocatorMainEditorBody(page, ph)) return ph;
    }
  } catch {
    /* ignore */
  }

  for (const scope of [page, editorFrame(page)] as Array<Page | FrameLocator>) {
    const mainParagraph = await pickMainBodyParagraph(page, scope);
    if (mainParagraph) return mainParagraph;

    const bodySection = scope
      .locator('.se-components-wrap .se-section-text:not(.se-section-documentTitle)')
      .first();
    try {
      if (
        (await bodySection.count()) > 0 &&
        (await bodySection.isVisible({ timeout: 600 }).catch(() => false)) &&
        (await isLocatorBodySection(page, bodySection))
      ) {
        const paragraph = bodySection.locator('.se-text-paragraph[contenteditable="true"]').first();
        if (
          (await paragraph.count()) > 0 &&
          (await paragraph.isVisible({ timeout: 300 }).catch(() => false)) &&
          (await isLocatorMainEditorBody(page, paragraph))
        ) {
          return paragraph;
        }
        return bodySection;
      }
    } catch {
      /* ignore */
    }

    for (const sel of BLOG_BODY_SELECTORS) {
      const loc = scope.locator(sel).first();
      try {
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
          if (await isLocatorMainEditorBody(page, loc)) return loc;
        }
      } catch {
        /* ignore */
      }
    }
  }

  if ((await page.locator('#mainFrame').count().catch(() => 0)) > 0) {
    const legacy = page
      .frameLocator('#mainFrame')
      .locator('.se-content, .se-text-paragraph, [contenteditable="true"]')
      .first();
    if ((await legacy.count()) > 0 && (await legacy.isVisible().catch(() => false))) {
      if (await isLocatorMainEditorBody(page, legacy)) return legacy;
    }
  }

  return null;
}

export function isTitlePlaceholderText(text: string): boolean {
  const t = text.replace(/\u00a0/g, ' ').trim();
  return !t || TITLE_PLACEHOLDER_RE.test(t);
}

/** placeholder「제목」·빈 값 제외 — 실제 제목 입력 여부 */
export function isBlogTitleWritten(written: string, expected: string): boolean {
  const w = written.replace(/\u00a0/g, ' ').trim();
  const e = expected.replace(/\u00a0/g, ' ').trim();
  if (!w || isTitlePlaceholderText(w)) return false;
  if (w.length < 2) return false;
  const probe = Math.min(4, w.length, e.length);
  if (probe < 2) return w.length >= e.length * 0.5;
  return e.startsWith(w.slice(0, probe)) || w.startsWith(e.slice(0, probe));
}

export async function readBlogTitleText(titleLoc: Locator): Promise<string> {
  const inputVal = await titleLoc.inputValue().catch(() => '');
  if (inputVal.trim() && !isTitlePlaceholderText(inputVal)) return inputVal.trim();

  const inner = await titleLoc
    .evaluate((el) => {
      const node = el as HTMLElement;
      const clone = node.cloneNode(true) as HTMLElement;
      for (const ph of clone.querySelectorAll('.se-placeholder, [class*="placeholder"]')) {
        ph.remove();
      }
      return (clone.innerText ?? clone.textContent ?? '').trim();
    })
    .catch(() => '');

  if (inner && !isTitlePlaceholderText(inner)) return inner;

  const text = await titleLoc.textContent().catch(() => '');
  const t = (text ?? '').trim();
  return isTitlePlaceholderText(t) ? '' : t;
}

export async function isFocusInTitleArea(page: Page): Promise<boolean> {
  return page
    .evaluate((sel) => {
      const el = document.activeElement;
      if (!el) return false;
      return !!el.closest(sel);
    }, TITLE_SECTION_SELECTOR)
    .catch(() => false);
}

/** 클릭한 제목·본문 locator에 포커스가 있는지 — SE ONE placeholder 입력은 closest 미매칭 방지 */
export async function isFocusOnLocator(loc: Locator): Promise<boolean> {
  return loc
    .evaluate((el) => {
      const active = document.activeElement;
      if (!active) return false;
      return el === active || el.contains(active);
    })
    .catch(() => false);
}

async function hasTitleFieldFocus(page: Page, titleLoc: Locator): Promise<boolean> {
  if (await isFocusOnLocator(titleLoc)) return true;
  return isFocusInTitleArea(page);
}

async function hasBodyFieldFocus(page: Page, bodyLoc: Locator): Promise<boolean> {
  if (await isFocusOnLocator(bodyLoc)) return true;
  return isFocusInBodyArea(page);
}

export async function isFocusInBodyArea(page: Page): Promise<boolean> {
  return page
    .evaluate(
      ({ titleSel, bodySel }) => {
        const el = document.activeElement;
        if (!el) return false;
        if (el.closest(titleSel)) return false;
        return !!el.closest(bodySel);
      },
      { titleSel: TITLE_SECTION_SELECTOR, bodySel: BODY_SECTION_SELECTOR },
    )
    .catch(() => false);
}

/** 제목란 클릭 — 포커스 검증 실패해도 throw 안 함(입력 검증은 typeBlogTitle) */
export async function focusBlogTitleField(page: Page, titleLoc: Locator): Promise<void> {
  if (await isDraftResumePopupVisible(page)) {
    await sleep(300);
  }

  await titleLoc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});

  const editable = page
    .locator(
      '.se-section-documentTitle [contenteditable="true"], .se-documentTitle [contenteditable="true"]',
    )
    .first();
  const hasEditable =
    (await editable.count()) > 0 && (await editable.isVisible({ timeout: 500 }).catch(() => false));
  const target = hasEditable ? editable : titleLoc;

  await humanClickLocator(page, target);
  await sleep(randomBetweenTitleFocus());

  if (!(await hasTitleFieldFocus(page, target)) && !(await isFocusInTitleArea(page))) {
    await humanClickLocator(page, titleLoc);
    await sleep(180);
  }
}

export async function focusBlogBodyField(page: Page, bodyLoc: Locator, maxAttempts = 5): Promise<void> {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (await isDraftResumePopupVisible(page)) {
      await sleep(200);
      continue;
    }
    await dismissSeOneMaterialPopup(page);
    await bodyLoc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    await humanClickBodyParagraph(page, bodyLoc);
    await sleep(randomBetweenTitleFocus());
    if (await hasBodyFieldFocus(page, bodyLoc)) return;
  }
}

/** 본문 상단 1/4 지점 클릭 — 하단 글감 독·툴바 오클릭 방지 */
async function humanClickBodyParagraph(page: Page, bodyLoc: Locator): Promise<void> {
  await bodyLoc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await bodyLoc.boundingBox().catch(() => null);
  if (!box || box.width < 8 || box.height < 8) {
    await humanClickLocator(page, bodyLoc);
    return;
  }

  const jitter = 6 + Math.floor(Math.random() * 6);
  const x = box.x + box.width / 2 + Math.floor(Math.random() * jitter * 2) - jitter;
  const y = box.y + Math.min(Math.max(box.height * 0.22, 24), 72) + Math.floor(Math.random() * 10);
  await humanMouseMove(page, x, y);
  await sleep(100 + Math.floor(Math.random() * 200));
  await page.mouse.click(x, y);
}

/** 제목 아래 본문 placeholder 클릭 — contenteditable paragraph 생성 유도 */
async function clickSeOneBodyPlaceholder(page: Page, titleLoc: Locator | null): Promise<void> {
  await dismissSeOneMaterialPopup(page);

  const section = page
    .locator('.se-components-wrap .se-section-text:not(.se-section-documentTitle)')
    .first();
  if (
    (await section.isVisible({ timeout: 1500 }).catch(() => false)) &&
    (await isLocatorBodySection(page, section))
  ) {
    await humanClickBodyParagraph(page, section);
    await sleep(300);
    return;
  }

  if (!titleLoc) return;
  const box = await titleLoc.boundingBox().catch(() => null);
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height + 56;
  await humanMouseMove(page, x, y);
  await sleep(120);
  await page.mouse.click(x, y);
  await sleep(300);
}

/** 본문란 확보 — 제목 입력 직후 paragraph 미생성 시 placeholder 클릭 후 재탐색 */
export async function ensureBlogBodyLocator(
  page: Page,
  titleLoc?: Locator | null,
): Promise<Locator | null> {
  const title = titleLoc ?? (await findBlogTitleLocator(page));
  for (let i = 0; i < 5; i += 1) {
    await prepareSeOneEditorSurfaceForBody(page);
    const loc = await findBlogBodyLocator(page);
    if (loc) return loc;
    await clickSeOneBodyPlaceholder(page, title);
    await sleep(350);
  }
  return null;
}

async function prepareSeOneEditorSurfaceForBody(page: Page): Promise<void> {
  await dismissSeOneMaterialPopup(page);
  if (await isDraftResumePopupVisible(page)) {
    await sleep(200);
  }
}

function randomBetweenTitleFocus(): number {
  return 180 + Math.floor(Math.random() * 140);
}

/** 제목란만 비움 — page.keyboard Control+A 금지(본문 블록 전체 선택 방지) */
export async function clearBlogTitleField(titleLoc: Locator): Promise<void> {
  await titleLoc
    .evaluate((el) => {
      const node = el as HTMLElement;
      node.focus();
      if (node.isContentEditable) {
        node.innerHTML = '';
        node.textContent = '';
      } else if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        node.value = '';
      }
    })
    .catch(() => {});
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

/** 취소선 토글만 해제 — Escape·Control+A는 팝업·블록 선택을 악화시킬 수 있어 사용 안 함 */
export async function clearSeOneEditorFormatting(page: Page): Promise<void> {
  if (await isDraftResumePopupVisible(page)) return;

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
