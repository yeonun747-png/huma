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
  '.se-section-text:not(.se-section-documentTitle), .se-text-paragraph[contenteditable="true"], .se-content';

const TITLE_PLACEHOLDER_RE = /^(제목|title)$/i;

/** 임시저장 이어쓰기 팝업 — 취소/확인 버튼이 실제로 보일 때만 true (닫힌 뒤 DOM 잔여 오탐 방지) */
export async function isDraftResumePopupVisible(page: Page): Promise<boolean> {
  const fast = await page
    .evaluate(() => {
      const re = /작성\s*중인\s*글|이어서\s*작성하시겠습니까|이어서\s*작성/;
      const nodes = document.querySelectorAll(
        '[class*="se-popup"], [role="dialog"], [class*="popup"]',
      );
      for (const node of Array.from(nodes)) {
        const el = node as HTMLElement;
        if (!re.test(el.textContent ?? '')) continue;
        const r = el.getBoundingClientRect();
        if (el.offsetParent === null || r.width <= 0 || r.height <= 0) continue;
        const actionBtn = el.querySelector(
          'button.se-popup-button-cancel, .se-popup-button-cancel, button.se-popup-button-confirm, .se-popup-button-confirm',
        ) as HTMLElement | null;
        if (actionBtn && actionBtn.offsetParent !== null) {
          const br = actionBtn.getBoundingClientRect();
          if (br.width > 0 && br.height > 0) return true;
        }
      }
      return false;
    })
    .catch(() => null);
  if (fast !== null) return fast;

  const loc = page
    .locator('[class*="se-popup"], [role="dialog"]')
    .filter({ hasText: /작성\s*중인\s*글|이어서\s*작성/ })
    .locator('button.se-popup-button-cancel, .se-popup-button-cancel, button.se-popup-button-confirm')
    .first();
  return loc.isVisible({ timeout: 300 }).catch(() => false);
}

/** elementFromPoint — 임시저장 모달만 차단(툴바·잔여 dim 오탐 제외) */
async function isPointBlockedByDraftModal(page: Page, x: number, y: number): Promise<boolean> {
  return page
    .evaluate(
      ({ px, py }) => {
        const hit = document.elementFromPoint(px, py);
        if (!hit) return false;
        if (
          hit.closest(
            '.se-section-documentTitle, .se-documentTitle, .se-section-text, .se-text-paragraph[contenteditable="true"]',
          )
        ) {
          return false;
        }
        const modal = hit.closest('.se-popup, [role="dialog"]');
        if (!modal) return false;
        const text = modal.textContent ?? '';
        return /작성\s*중인\s*글|이어서\s*작성/.test(text);
      },
      { px: x, py: y },
    )
    .catch(() => false);
}

async function focusTitleEditableNode(loc: Locator): Promise<void> {
  await loc
    .evaluate((el) => {
      const node = el as HTMLElement;
      const target =
        node.matches('[contenteditable="true"]')
          ? node
          : ((node.querySelector(
              '.se-text-paragraph[contenteditable="true"], [contenteditable="true"]',
            ) as HTMLElement | null) ?? node);
      target.focus();
      const sel = window.getSelection();
      if (sel && target.isContentEditable) {
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    })
    .catch(() => {});
}

/** 제목 contenteditable 노출 — 임시저장 팝업만 제외 */
export async function isBlogTitleEditableVisible(page: Page): Promise<boolean> {
  if (await isDraftResumePopupVisible(page)) return false;

  const title = page
    .locator(
      '.se-section-documentTitle [contenteditable="true"], .se-documentTitle [contenteditable="true"], .se-section-documentTitle .se-text-paragraph[contenteditable="true"], .se-documentTitle .se-text-paragraph[contenteditable="true"]',
    )
    .first();
  if (!(await title.isVisible({ timeout: 600 }).catch(() => false))) return false;

  const box = await title.boundingBox().catch(() => null);
  return !!(box && box.height >= 8 && box.width >= 24);
}

/** 제목란 노출·클릭 유도 — 본문 포커스만 잡힌 채 제목 대기에서 멈출 때 */
export async function recoverBlogTitleSection(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      window.scrollTo(0, 0);
      for (const sel of ['.se-wrap', '.se-container', '.se-components-wrap', '.se-main-container']) {
        const el = document.querySelector(sel);
        if (el && 'scrollTop' in el) (el as HTMLElement).scrollTop = 0;
      }
    })
    .catch(() => {});

  await dismissSeOneMaterialPopup(page);

  const titleEditable = page
    .locator(
      '.se-section-documentTitle [contenteditable="true"], .se-documentTitle [contenteditable="true"]',
    )
    .first();
  if (await titleEditable.isVisible({ timeout: 500 }).catch(() => false)) {
    await titleEditable.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await humanClickLocator(page, titleEditable);
    await sleep(250);
    await focusTitleEditableNode(titleEditable);
    return;
  }

  const titleSection = page.locator('.se-section-documentTitle, .se-documentTitle').first();
  if (await titleSection.isVisible({ timeout: 500 }).catch(() => false)) {
    await titleSection.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await humanClickLocator(page, titleSection);
    await sleep(250);
    const paragraph = titleSection.locator('.se-text-paragraph[contenteditable="true"]').first();
    if ((await paragraph.count()) > 0) {
      await focusTitleEditableNode(paragraph);
    }
  }
}

/** 제목란 클릭·입력 가능 — 임시저장 팝업 없고 제목 노드가 보이면 준비 완료 */
export async function isBlogTitleSectionReady(page: Page): Promise<boolean> {
  return isBlogTitleEditableVisible(page);
}

/** 팝업 닫힌 뒤 제목란 interactable 될 때까지 대기 */
export async function waitForBlogTitleSectionReady(page: Page, maxMs = 35_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  let lastRecover = 0;
  let recoverCount = 0;

  while (Date.now() < deadline) {
    if (await isBlogTitleSectionReady(page)) return;
    if (recoverCount < 2 && Date.now() - lastRecover > 900) {
      await recoverBlogTitleSection(page);
      lastRecover = Date.now();
      recoverCount += 1;
      await sleep(350);
      if (await isBlogTitleSectionReady(page)) return;
      continue;
    }
    if (!(await isDraftResumePopupVisible(page)) && (await isBlogTitleEditableVisible(page))) {
      return;
    }
    await sleep(250);
  }
  if (await isDraftResumePopupVisible(page)) {
    throw new Error('DRAFT_RESUME_POPUP_STILL_VISIBLE');
  }
  throw new Error('BLOG_TITLE_SECTION_NOT_READY');
}

/** 제목란 — SE ONE placeholder "제목" 우선 (팝업 dim 뒤 요소 제외) */
export async function findBlogTitleLocator(page: Page): Promise<Locator | null> {
  if (await isDraftResumePopupVisible(page)) return null;

  const titleEditable = page
    .locator(
      '.se-section-documentTitle [contenteditable="true"], .se-documentTitle [contenteditable="true"], .se-section-documentTitle .se-text-paragraph[contenteditable="true"], .se-documentTitle .se-text-paragraph[contenteditable="true"]',
    )
    .first();
  if (
    (await titleEditable.count()) > 0 &&
    (await titleEditable.isVisible({ timeout: 800 }).catch(() => false))
  ) {
    return titleEditable;
  }

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

/** placeholder「제목」·빈 값·팝업 오염 제외 — 실제 제목 입력 여부 */
export function isBlogTitleWritten(written: string, expected: string): boolean {
  const w = written.replace(/\u00a0/g, ' ').trim();
  const e = expected.replace(/\u00a0/g, ' ').trim();
  if (!w || isTitlePlaceholderText(w)) return false;
  if (/이어서\s*작성|작성\s*중인\s*글|배경\s*사진|제목위치|삭제취소확인/.test(w)) return false;
  if (w.length < 2) return false;
  const probe = Math.min(4, w.length, e.length);
  if (probe < 2) return w.length >= e.length * 0.5 && w.length <= e.length * 1.15;
  if (w.length > e.length * 1.15) return false;
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
  if (await isFocusInTitleArea(page)) return false;
  if (await isFocusOnLocator(bodyLoc)) return true;
  return isFocusInBodyArea(page);
}

/** 제목 contenteditable blur — 본문 입력 전 DOM 포커스 해제 */
export async function blurBlogTitleField(page: Page): Promise<void> {
  await page
    .evaluate((sel) => {
      const nodes = document.querySelectorAll(sel);
      for (const node of nodes) {
        if (node instanceof HTMLElement) node.blur();
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('.se-section-documentTitle, .se-documentTitle')) {
        active.blur();
      }
    }, '.se-section-documentTitle [contenteditable="true"], .se-documentTitle [contenteditable="true"]')
    .catch(() => {});
}

/** 본문 입력 대상 contenteditable (section wrapper → paragraph) */
export async function resolveBodyEditableLocator(bodyLoc: Locator): Promise<Locator> {
  const paragraph = bodyLoc.locator('.se-text-paragraph[contenteditable="true"]').first();
  if (
    (await paragraph.count()) > 0 &&
    (await paragraph.isVisible({ timeout: 500 }).catch(() => false))
  ) {
    return paragraph;
  }
  const nested = bodyLoc.locator('[contenteditable="true"]').first();
  if (
    (await nested.count()) > 0 &&
    (await nested.isVisible({ timeout: 400 }).catch(() => false))
  ) {
    return nested;
  }
  return bodyLoc;
}

/** locator에 직접 insertText — 팝업·dim 뒤 DOM 조작 금지 */
export async function insertTextIntoBlogEditable(
  page: Page,
  loc: Locator,
  text: string,
): Promise<void> {
  if (await isDraftResumePopupVisible(page)) {
    throw new Error('DRAFT_RESUME_POPUP_STILL_VISIBLE');
  }

  await loc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  const box = await loc.boundingBox().catch(() => null);
  if (!box || box.width < 8 || box.height < 8) {
    throw new Error('BLOG_EDITABLE_NOT_INTERACTABLE');
  }

  const blocked = await isPointBlockedByDraftModal(
    page,
    box.x + box.width / 2,
    box.y + Math.min(box.height / 2, 28),
  );
  if (blocked && (await isDraftResumePopupVisible(page))) {
    throw new Error('BLOG_EDITABLE_BLOCKED_BY_OVERLAY');
  }

  const beforeLen = await loc
    .evaluate((el) => {
      const node = el as HTMLElement;
      const target = node.matches('[contenteditable="true"]')
        ? node
        : (node.querySelector('[contenteditable="true"]') as HTMLElement | null);
      return (target ?? node).textContent?.length ?? 0;
    })
    .catch(() => 0);

  await loc.evaluate((el, t) => {
    const node = el as HTMLElement;
    if (node.closest('.se-popup, [role="dialog"]')) return;
    const editable =
      node.matches('[contenteditable="true"]')
        ? node
        : (node.querySelector('[contenteditable="true"]') as HTMLElement | null);
    const target = editable ?? node;
    if (target.closest('.se-popup, [role="dialog"]')) return;
    target.focus();

    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    if (!document.execCommand('insertText', false, t)) {
      target.textContent = (target.textContent ?? '') + t;
    }
  }, text);

  if (text.length > 0) {
    const afterLen = await loc
      .evaluate((el) => {
        const node = el as HTMLElement;
        const target = node.matches('[contenteditable="true"]')
          ? node
          : (node.querySelector('[contenteditable="true"]') as HTMLElement | null);
        return (target ?? node).textContent?.length ?? 0;
      })
      .catch(() => 0);
    if (afterLen <= beforeLen) {
      throw new Error('BLOG_EDITABLE_INSERT_NOOP');
    }
  }
}

function resolveEditableNode(el: HTMLElement): HTMLElement {
  if (el.matches('[contenteditable="true"]')) return el;
  return (el.querySelector('[contenteditable="true"]') as HTMLElement | null) ?? el;
}

/** 본문 단락 구분 — page.keyboard Enter 금지 */
export async function insertParagraphBreakInBlogEditable(
  page: Page,
  loc: Locator,
  lineBreaks = 2,
): Promise<void> {
  if (await isDraftResumePopupVisible(page)) {
    throw new Error('DRAFT_RESUME_POPUP_STILL_VISIBLE');
  }
  const breaks = '\n'.repeat(Math.max(1, lineBreaks));
  await loc.evaluate((el, text) => {
    const target = resolveEditableNode(el as HTMLElement);
    if (target.closest('.se-popup, [role="dialog"]')) return;
    target.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand('insertText', false, text);
  }, breaks);
}

/** input/textarea 직접 insert — 발행 태그 등 */
export async function insertTextIntoInputLocator(loc: Locator, text: string): Promise<void> {
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await loc.focus().catch(() => {});
  try {
    await loc.fill(text);
    return;
  } catch {
    /* fall through */
  }
  await loc.evaluate((el, t) => {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    input.focus();
    input.value = t;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

export async function readBlogBodyText(bodyLoc: Locator): Promise<string> {
  return bodyLoc
    .evaluate((el) => {
      const node = el as HTMLElement;
      const clone = node.cloneNode(true) as HTMLElement;
      for (const ph of clone.querySelectorAll('.se-placeholder, [class*="placeholder"]')) {
        ph.remove();
      }
      return (clone.innerText ?? clone.textContent ?? '').trim();
    })
    .catch(() => '');
}

/** CAPTCHA 재개·재시도 — 본문이 이미 채워졌으면 스킵 */
export function isBlogBodySubstantiallyWritten(bodyText: string, expectedContent: string): boolean {
  const b = bodyText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const e = expectedContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  if (b.length < 60) return false;
  if (!e) return b.length >= 60;
  const probe = Math.min(48, e.length);
  return b.includes(e.slice(0, probe)) || e.includes(b.slice(0, Math.min(probe, b.length)));
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
    throw new Error('DRAFT_RESUME_POPUP_STILL_VISIBLE');
  }

  await titleLoc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});

  const editable = await resolveTitleEditableLocator(page, titleLoc);
  const hasEditable = (await editable.count()) > 0 && (await editable.isVisible({ timeout: 500 }).catch(() => false));
  const target = hasEditable ? editable : titleLoc;

  await humanClickLocator(page, target);
  await sleep(randomBetweenTitleFocus());
  await focusTitleEditableNode(target);

  if (!(await hasTitleFieldFocus(page, target)) && !(await isFocusInTitleArea(page))) {
    await humanClickLocator(page, editable);
    await sleep(180);
    await focusTitleEditableNode(editable);
  }
}

export async function focusBlogBodyField(page: Page, bodyLoc: Locator, maxAttempts = 6): Promise<void> {
  const editable = await resolveBodyEditableLocator(bodyLoc);
  for (let i = 0; i < maxAttempts; i += 1) {
    if (await isDraftResumePopupVisible(page)) {
      await sleep(200);
      continue;
    }
    await blurBlogTitleField(page);
    await dismissSeOneMaterialPopup(page);
    await editable.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    await humanClickBodyParagraph(page, editable);
    await editable.focus().catch(() => {});
    await sleep(randomBetweenTitleFocus());
    if ((await hasBodyFieldFocus(page, editable)) && !(await isFocusInTitleArea(page))) return;
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

/** 본문 placeholder — 「글감과 함께 나의 일상을 기록해보세요!」 마우스 클릭 */
export async function clickBlogBodyPlaceholder(page: Page): Promise<void> {
  if (!(await isSeOneEditorSurfaceHealthy(page))) {
    throw new Error('BLOG_EDITOR_NOT_READY');
  }

  await dismissSeOneMaterialPopup(page);

  const byText = page
    .locator(
      '.se-section-text:not(.se-section-documentTitle) .se-placeholder, .se-section-text:not(.se-section-documentTitle) [class*="placeholder"]',
    )
    .filter({ hasText: /글감과 함께|나의 일상을 기록/ })
    .first();
  if (await byText.isVisible({ timeout: 2000 }).catch(() => false)) {
    await humanClickLocator(page, byText);
    await sleep(300);
    return;
  }

  try {
    const ph = page.getByPlaceholder(/나의 일상|일상을 기록|본문/).first();
    if (await ph.isVisible({ timeout: 1500 }).catch(() => false)) {
      await humanClickLocator(page, ph);
      await sleep(300);
      return;
    }
  } catch {
    /* ignore */
  }

  const section = page
    .locator('.se-components-wrap .se-section-text:not(.se-section-documentTitle)')
    .first();
  if (
    (await section.isVisible({ timeout: 1000 }).catch(() => false)) &&
    (await isLocatorBodySection(page, section))
  ) {
    await humanClickBodyParagraph(page, section);
    await sleep(300);
  }
}

/**
 * 제목칸만 비움 — 중복 입력 방지.
 * 전역 Ctrl+A/Delete는 포커스가 제목 밖일 때 에디터 전체를 선택·삭제해
 * 본문이 통째로 지워지는 사고가 발생하므로 절대 사용하지 않는다.
 * 반드시 제목 contenteditable 노드 내부로 한정된 selection·delete만 수행한다.
 */
async function clearFocusedTitleEditable(_page: Page, editable: Locator, force = false): Promise<void> {
  if (!force) {
    const existing = (await readBlogTitleText(editable)).trim();
    if (!existing || isTitlePlaceholderText(existing)) {
      await focusTitleEditableNode(editable);
      return;
    }
  }
  await clearBlogTitleField(editable);
  await sleep(80);
}

/**
 * SE ONE 제목 — 제목칸을 마우스로 "단 1회"만 클릭한 뒤 입력.
 * 폴백도 절대 다시 클릭하지 않고(제목 2번 클릭 방지), 제목 노드에 한정해
 * 재포커스 후 재삽입/클립보드 붙여넣기만 한다. 전역 키보드 선택·삭제는 쓰지 않는다.
 */
export async function pasteBlogTitleField(page: Page, titleLoc: Locator, text: string): Promise<void> {
  if (await isDraftResumePopupVisible(page)) {
    throw new Error('DRAFT_RESUME_POPUP_STILL_VISIBLE');
  }

  const editable = await resolveTitleEditableLocator(page, titleLoc);
  await editable.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});

  // 제목칸 마우스 클릭 — 1회만 (시뮬과 동일: 클릭 후 insertText, 빈 칸은 DOM 삭제 없음)
  await humanClickLocator(page, editable);
  await sleep(200);

  await focusTitleEditableNode(editable);
  await page.keyboard.insertText(text);
  await sleep(300);

  let written = await readBlogTitleText(titleLoc);
  if (!isBlogTitleWritten(written, text)) {
    // 폴백 ① — 재클릭 없이 기존 텍스트만 비우고 재삽입
    await clearFocusedTitleEditable(page, editable, true);
    await focusTitleEditableNode(editable);
    await page.keyboard.insertText(text);
    await sleep(300);
    written = await readBlogTitleText(titleLoc);
  }

  if (!isBlogTitleWritten(written, text)) {
    // 폴백 ② — 재클릭 없이 클립보드 붙여넣기
    await clearFocusedTitleEditable(page, editable, true);
    await focusTitleEditableNode(editable);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page
      .evaluate(async (t) => {
        try {
          await navigator.clipboard.writeText(t);
        } catch {
          /* 포커스·권한 실패 */
        }
      }, text)
      .catch(() => {});
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
    await sleep(350);
    written = await readBlogTitleText(titleLoc);
  }

  if (!isBlogTitleWritten(written, text)) {
    throw new Error('BLOG_TITLE_WRITE_FAILED');
  }
}

/** SE ONE 본문 — 본문칸 마우스 이동·클릭 후 단락별 붙여넣기형 입력(insertText) */
export async function pasteBlogBodyContent(page: Page, bodyLoc: Locator, content: string): Promise<void> {
  if (await isDraftResumePopupVisible(page)) {
    throw new Error('DRAFT_RESUME_POPUP_STILL_VISIBLE');
  }

  const editable = await resolveBodyEditableLocator(bodyLoc);
  await editable.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  await humanClickLocator(page, editable);
  await sleep(200);

  const paragraphs = content.split('\n\n').filter(Boolean);
  for (let i = 0; i < paragraphs.length; i += 1) {
    await page.keyboard.insertText(paragraphs[i]!);
    await sleep(300);
    if (i < paragraphs.length - 1) {
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await sleep(200);
    }
  }
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
  if (!(await isSeOneEditorSurfaceHealthy(page))) return null;

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

/** 제목 paragraph contenteditable — SE ONE wrapper 대신 실제 입력 노드 */
export async function resolveTitleEditableLocator(page: Page, titleLoc: Locator): Promise<Locator> {
  const fromLoc = titleLoc.locator('.se-text-paragraph[contenteditable="true"]').first();
  if (
    (await fromLoc.count()) > 0 &&
    (await fromLoc.isVisible({ timeout: 500 }).catch(() => false))
  ) {
    return fromLoc;
  }

  const sectionParagraph = page
    .locator(
      '.se-section-documentTitle .se-text-paragraph[contenteditable="true"], .se-documentTitle .se-text-paragraph[contenteditable="true"]',
    )
    .first();
  if (
    (await sectionParagraph.count()) > 0 &&
    (await sectionParagraph.isVisible({ timeout: 500 }).catch(() => false))
  ) {
    return sectionParagraph;
  }

  const sectionEditable = page
    .locator(
      '.se-section-documentTitle [contenteditable="true"], .se-documentTitle [contenteditable="true"]',
    )
    .first();
  if (
    (await sectionEditable.count()) > 0 &&
    (await sectionEditable.isVisible({ timeout: 500 }).catch(() => false))
  ) {
    return sectionEditable;
  }

  return titleLoc;
}

/** 제목란만 비움 — placeholder DOM 제거 금지(SE ONE 구조 파괴 방지) */
export async function clearBlogTitleField(titleLoc: Locator): Promise<void> {
  await titleLoc
    .evaluate((el) => {
      const node = el as HTMLElement;
      const target =
        node.matches('[contenteditable="true"]')
          ? node
          : (node.querySelector('[contenteditable="true"]') as HTMLElement | null) ?? node;
      target.focus();

      const clone = target.cloneNode(true) as HTMLElement;
      for (const ph of clone.querySelectorAll('.se-placeholder, [class*="placeholder"]')) {
        ph.remove();
      }
      const existing = (clone.innerText ?? clone.textContent ?? '').replace(/\u00a0/g, ' ').trim();
      const isEmptyOrPlaceholder = !existing || /^(제목|title)$/i.test(existing);

      if (isEmptyOrPlaceholder) {
        const sel = window.getSelection();
        if (sel && target.isContentEditable) {
          const caret = document.createRange();
          caret.selectNodeContents(target);
          caret.collapse(false);
          sel.removeAllRanges();
          sel.addRange(caret);
        }
        return;
      }

      if (target.isContentEditable) {
        const sel = window.getSelection();
        const delRange = document.createRange();
        delRange.selectNodeContents(target);
        delRange.deleteContents();
        if (sel) {
          const caret = document.createRange();
          caret.selectNodeContents(target);
          caret.collapse(false);
          sel.removeAllRanges();
          sel.addRange(caret);
        }
      } else if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.value = '';
      }
    })
    .catch(() => {});
}

/** SE ONE 제목 — pasteBlogTitleField 위임 (execCommand 체인 제거) */
export async function typeTextIntoBlogTitleField(
  page: Page,
  titleLoc: Locator,
  text: string,
): Promise<void> {
  await pasteBlogTitleField(page, titleLoc, text);
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

/** SE ONE 본체 로딩 상태 — 툴바·제목·본문 존재, 로딩 스피너 없음, 제목 위치 측정 */
async function probeSeOneLoadState(page: Page): Promise<{
  ready: boolean;
  strong: boolean;
  titleReady: boolean;
  box: { x: number; y: number; w: number; h: number } | null;
}> {
  return page
    .evaluate(() => {
      const onWrite = /postwrite|PostWriteForm|GoBlogWrite/i.test(location.href);
      if (!onWrite) return { ready: false, strong: false, titleReady: false, box: null };

      const visible = (el: Element | null): el is HTMLElement => {
        if (!el) return false;
        const node = el as HTMLElement;
        const r = node.getBoundingClientRect();
        return node.offsetParent !== null && r.width > 0 && r.height > 0;
      };

      // 로딩 스피너 — 회전 인디케이터(placeholder 클래스는 제외)
      const spinnerSel = [
        '.se-loading',
        '.se-loading-layer',
        '.se-loading-indicator',
        '.__se_loading',
        '.se-spinner',
      ];
      let spinnerVisible = false;
      for (const s of spinnerSel) {
        const node = document.querySelector(s);
        if (!visible(node)) continue;
        const r = (node as HTMLElement).getBoundingClientRect();
        const style = getComputedStyle(node as HTMLElement);
        if (r.width < 16 || r.height < 16) continue;
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (parseFloat(style.opacity) < 0.05) continue;
        spinnerVisible = true;
        break;
      }

      const title = document.querySelector(
        '.se-section-documentTitle [contenteditable="true"], .se-documentTitle [contenteditable="true"]',
      );
      const body = document.querySelector(
        '.se-section-text:not(.se-section-documentTitle), .se-component-content .se-text-paragraph, .se-components-wrap .se-section-text',
      );
      const bodyPlaceholder = document.querySelector(
        '.se-section-text:not(.se-section-documentTitle) .se-placeholder, .se-section-text:not(.se-section-documentTitle) [class*="placeholder"]',
      );
      const toolbar = document.querySelector('.se-toolbar, [class*="se-toolbar"], .se-menu, .se-toolbar-container');

      const tb = title instanceof HTMLElement ? title.getBoundingClientRect() : null;
      const titleOk = visible(title) && !!tb && tb.height >= 8 && tb.width >= 24;
      const bodyOk = visible(body) || visible(bodyPlaceholder);

      return {
        // strong: 툴바까지 — 본체가 완전히 그려진 상태
        strong: !spinnerVisible && titleOk && bodyOk && visible(toolbar),
        // ready: 스피너 없고 제목·본문(또는 placeholder)이 보이면 본문 입력 가능
        ready: !spinnerVisible && titleOk && bodyOk,
        // titleReady: 제목 입력만 — 본문은 제목 입력·클릭 후 생성되는 경우가 많음
        titleReady: !spinnerVisible && titleOk,
        box: tb ? { x: tb.x, y: tb.y, w: tb.width, h: tb.height } : null,
      };
    })
    .catch(() => ({ ready: false, strong: false, titleReady: false, box: null }));
}

/** 제목 마우스 입력 직전 — findBlogTitleLocator와 동일 기준(placeholder 포함) */
export async function isSeOneEditorReadyForTitleInput(page: Page): Promise<boolean> {
  if (await isDraftResumePopupVisible(page)) return false;
  const title = await findBlogTitleLocator(page);
  if (!title) return false;
  const box = await title.boundingBox().catch(() => null);
  return !!(box && box.height >= 8 && box.width >= 24);
}

/**
 * 제목란 노출 시 즉시 VNC 포인터 이동 후 Locator 반환.
 * probeSeOneLoadState(titleReady)와 findBlogTitleLocator 불일치로 무마우스 정체되는 문제 방지.
 */
export async function waitForBlogTitleInputReady(
  page: Page,
  maxMs = 45_000,
  onDraftPopup?: () => Promise<void>,
): Promise<Locator | null> {
  const deadline = Date.now() + maxMs;
  let pointerShown = false;

  while (Date.now() < deadline) {
    if (await isDraftResumePopupVisible(page)) {
      if (onDraftPopup) await onDraftPopup();
      pointerShown = false;
      await sleep(200);
      continue;
    }

    const title = await findBlogTitleLocator(page);
    if (!title) {
      await sleep(120);
      continue;
    }

    const box = await title.boundingBox().catch(() => null);
    if (!box || box.height < 8 || box.width < 24) {
      await sleep(120);
      continue;
    }

    if (!pointerShown) {
      pointerShown = true;
      await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    }
    return title;
  }

  return null;
}

/** 툴바·제목·본문이 모두 살아 있는지 — 붕괴 후 연쇄 클릭 방지 */
export async function isSeOneEditorSurfaceHealthy(page: Page): Promise<boolean> {
  if (await isDraftResumePopupVisible(page)) return false;
  const state = await probeSeOneLoadState(page);
  return state.ready;
}

/**
 * SE ONE 제목 입력 가능할 때까지 대기.
 * 팝업 없을 때는 titleReady(제목만)로 즉시 진행 — bodyOk 대기로 60초 무마우스 정체 방지.
 */
export async function waitForSeOneEditorFullyLoaded(
  page: Page,
  maxMs = 45_000,
  onDraftPopup?: () => Promise<void>,
): Promise<boolean> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const deadline = Date.now() + maxMs;
  let stableSince = 0;
  let lastBox: { x: number; y: number; w: number; h: number } | null = null;
  let postDraftCancel = false;
  let pointerAtTitle = false;

  while (Date.now() < deadline) {
    if (await isDraftResumePopupVisible(page)) {
      if (onDraftPopup) await onDraftPopup();
      postDraftCancel = true;
      stableSince = 0;
      lastBox = null;
      pointerAtTitle = false;
      await sleep(300);
      continue;
    }

    const state = await probeSeOneLoadState(page);
    const meets = postDraftCancel ? state.ready || state.titleReady : state.titleReady;

    if (meets && state.box) {
      const b = state.box;
      if (!pointerAtTitle) {
        pointerAtTitle = true;
        await humanMouseMove(page, b.x + b.w / 2, b.y + b.h / 2).catch(() => {});
      }
      const stableMs = postDraftCancel ? 350 : 250;
      if (
        lastBox &&
        Math.abs(lastBox.x - b.x) < 2 &&
        Math.abs(lastBox.y - b.y) < 2 &&
        Math.abs(lastBox.w - b.w) < 2 &&
        Math.abs(lastBox.h - b.h) < 2
      ) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) return true;
      } else {
        stableSince = Date.now();
      }
      lastBox = b;
    } else {
      stableSince = 0;
      lastBox = null;
    }
    await sleep(150);
  }

  return false;
}

export async function isNaverBlogEditorInteractable(page: Page): Promise<boolean> {
  if (await isDraftResumePopupVisible(page)) return false;

  const onPostwrite = /postwrite|PostWriteForm|GoBlogWrite/i.test(page.url());
  const hasLegacyFrame = (await page.locator('#mainFrame').count().catch(() => 0)) > 0;
  if (!onPostwrite && !hasLegacyFrame) return false;

  if (onPostwrite && (await isSeOneEditorShellReady(page))) return true;
  if (await isBlogTitleSectionReady(page)) return true;
  if ((await findBlogBodyLocator(page)) !== null) return true;

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
