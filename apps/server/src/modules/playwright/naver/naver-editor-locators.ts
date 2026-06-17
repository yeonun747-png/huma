import type { FrameLocator, Locator, Page } from 'playwright';
import { planParagraphPaste } from '@huma/shared';

import { humanClickLocator, humanMouseMove } from '../../human-engine/mouse.js';
import { humanBriefPauseMs, humanPressSequentially } from '../../human-engine/korean-ime.js';
import { humanSleep } from '../../human-engine/typing.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import { resolvePasteRatio } from '../../../lib/settings.js';
import { randomBetween, sleep } from '../../../lib/utils.js';
import { logOperation } from '../../../lib/log-emitter.js';

export function editorFrame(page: Page): FrameLocator {
  return page.frameLocator('#mainFrame');
}

/** 구형 postwrite iframe — 현행 SE ONE(postwrite URL, #mainFrame 없음)에서는 false */
export async function hasLegacyMainFrame(page: Page): Promise<boolean> {
  return (await page.locator('#mainFrame').count().catch(() => 0)) > 0;
}

/** SE ONE은 page 직접, 구형만 #mainFrame iframe 추가(page 우선) */
export async function editorLocatorScopes(page: Page): Promise<Array<Page | FrameLocator>> {
  const scopes: Array<Page | FrameLocator> = [page];
  if (await hasLegacyMainFrame(page)) {
    scopes.push(editorFrame(page));
  }
  return scopes;
}

const HELP_PANEL_ROOT_SELECTORS = [
  '.se-help-panel',
  '[class*="se-help-panel"]',
  '[class*="help-panel"]',
  '.se-sidebar',
];

const HELP_PANEL_CLOSE_SELECTORS = [
  '.se-help-panel-close-button',
  'button.se-help-panel-close-button',
  '.btn_close_help',
  '.se-help-panel button[aria-label="닫기"]',
  '.se-help-panel button[aria-label*="닫"]',
  '.se-help-panel button[class*="close"]',
  '.se-sidebar button[aria-label="닫기"]',
  '.se-sidebar button[aria-label*="닫"]',
  '.se-sidebar button[class*="close"]',
  '.se-guide-close-button',
  '.se-onboarding-close-button',
  'button.se-help-toolbar-button[aria-pressed="true"]',
  'button[class*="help"][class*="toolbar"][aria-pressed="true"]',
];

/** SE ONE 우측 「도움말」 사이드바 — 글쓰기 영역을 가리면 true */
export async function isSeOneHelpPanelVisible(page: Page): Promise<boolean> {
  for (const scope of await editorLocatorScopes(page)) {
    for (const rootSel of HELP_PANEL_ROOT_SELECTORS) {
      const root = scope.locator(rootSel).first();
      if (!(await root.isVisible({ timeout: 250 }).catch(() => false))) continue;

      const box = await root.boundingBox().catch(() => null);
      const vp = page.viewportSize();
      const onRight = !vp || !box || box.x + box.width / 2 > vp.width * 0.45;
      if (!onRight) continue;

      const hasHelpTitle = await root
        .evaluate((el) => {
          const text = (el.textContent ?? '').replace(/\s+/g, '');
          return text.includes('도움말') || text.includes('WhatsNew') || text.includes('시작하기');
        })
        .catch(() => false);
      if (hasHelpTitle || rootSel.includes('help')) return true;
    }
  }
  return false;
}

async function clickHelpCloseInScope(page: Page, scope: Page | FrameLocator): Promise<boolean> {
  for (const sel of HELP_PANEL_CLOSE_SELECTORS) {
    const btn = scope.locator(sel).first();
    if (!(await btn.isVisible({ timeout: 350 }).catch(() => false))) continue;
    try {
      await humanClickLocator(page, btn, undefined, [70, 160]);
      return true;
    } catch {
      await btn.click({ timeout: 2500, force: true }).catch(() => {});
      return true;
    }
  }
  return false;
}

/** 도움말 사이드바 닫기 — 에디터 진입 직후·입력 직전 최우선 */
export async function dismissSeOneHelpPanel(page: Page): Promise<boolean> {
  if (!(await isSeOneHelpPanelVisible(page))) return false;

  await logOperation({
    level: 'info',
    message: '[post_blog] 도움말 패널 감지 — 닫기 시도',
  }).catch(() => {});

  for (let round = 0; round < 5; round += 1) {
    let acted = false;

    for (const scope of await editorLocatorScopes(page)) {
      if (await clickHelpCloseInScope(page, scope)) acted = true;
    }

    const jsClosed = await page
      .evaluate(() => {
        const roots = [
          ...document.querySelectorAll(
            '.se-help-panel, [class*="se-help-panel"], [class*="help-panel"], .se-sidebar',
          ),
        ];
        for (const root of roots) {
          const rect = root.getBoundingClientRect();
          if (rect.width < 80 || rect.height < 80) continue;
          if (rect.left < window.innerWidth * 0.45) continue;

          const close = root.querySelector<HTMLElement>(
            'button[class*="close"], .se-help-panel-close-button, [aria-label="닫기"], [aria-label*="닫"]',
          );
          if (close) {
            close.click();
            return true;
          }

          const heading = [...root.querySelectorAll('h1,h2,h3,strong,span,div,p')].find(
            (el) => (el.textContent ?? '').trim() === '도움말',
          );
          if (heading) {
            const panel = heading.closest('.se-help-panel, .se-sidebar, aside, [class*="sidebar"]');
            const panelClose = panel?.querySelector<HTMLElement>(
              'button[class*="close"], [aria-label="닫기"], [aria-label*="닫"]',
            );
            if (panelClose) {
              panelClose.click();
              return true;
            }
          }

          root.remove();
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (jsClosed) acted = true;

    await sleep(280);
    if (!(await isSeOneHelpPanelVisible(page))) {
      await logOperation({
        level: 'info',
        message: '[post_blog] 도움말 패널 닫기 완료',
      }).catch(() => {});
      return true;
    }
    if (!acted) break;
  }

  return !(await isSeOneHelpPanelVisible(page));
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

const BLOG_BODY_SECTION_LOCATOR =
  '.se-components-wrap .se-section-text:not(.se-section-documentTitle)';

/** SE ONE 본문 섹션 — visibility·height 필터 없이 locator만 반환(placeholder 클릭 직후 즉시 입력용) */
export function blogBodySectionLocator(page: Page): Locator {
  return page.locator(BLOG_BODY_SECTION_LOCATOR).first();
}

const TITLE_PLACEHOLDER_RE = /^(제목|title)$/i;
const BLOG_TITLE_MAX_LEN = 100;

/** SE ONE 툴바·컨텍스트 UI가 제목 paragraph innerText에 섞일 때 */
const TITLE_CHROME_NOISE_RE =
  /위치\s*이동|제목\s*위치|제목위치|배경\s*사진|삭제\s*취소|삭제취소|취소\s*확인|삭제취소확인/i;

export function isTitleEditorChromeText(text: string): boolean {
  const t = text.replace(/\u00a0/g, ' ').trim();
  if (!t) return false;
  if (TITLE_CHROME_NOISE_RE.test(t)) return true;
  return /위치.*제목.*배경|배경.*사진.*삭제/.test(t);
}

function truncateBlogTitle(text: string): string {
  const t = text.replace(/\u00a0/g, ' ').trim();
  if (t.length <= BLOG_TITLE_MAX_LEN) return t;
  return t.slice(0, BLOG_TITLE_MAX_LEN);
}

function sanitizeTitleRead(text: string): string {
  const t = text.replace(/\u00a0/g, ' ').trim();
  if (!t || isTitlePlaceholderText(t) || isTitleEditorChromeText(t)) return '';
  return t;
}

/** OS IME(CDP 두벌식) 실패 시 raw 알파벳만 쌓인 제목 — dusdns dlekf … */
function isLikelyDubeolsikGarbage(text: string, expected: string): boolean {
  const w = text.replace(/\u00a0/g, ' ').trim();
  if (!w || !/[가-힣]/.test(expected)) return false;
  const hangulCount = (w.match(/[가-힣]/g) ?? []).length;
  const latinCount = (w.match(/[a-z]/gi) ?? []).length;
  return latinCount >= 4 && hangulCount < Math.min(4, expected.length * 0.2);
}

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

async function focusBodyEditableNode(loc: Locator): Promise<void> {
  await focusTitleEditableNode(loc);
}

/** 본문 contenteditable paragraph — section wrapper 제외 */
async function findBlogBodyParagraphOnly(page: Page): Promise<Locator | null> {
  await dismissSeOneMaterialPopup(page);

  for (const scope of await editorLocatorScopes(page)) {
    const mainParagraph = await pickMainBodyParagraph(page, scope);
    if (mainParagraph) return mainParagraph;

    const paragraph = scope
      .locator(
        '.se-components-wrap .se-section-text:not(.se-section-documentTitle) .se-text-paragraph[contenteditable="true"]',
      )
      .first();
    if (
      (await paragraph.count().catch(() => 0)) > 0 &&
      (await paragraph.isVisible({ timeout: 400 }).catch(() => false)) &&
      (await isBodyParagraphEditable(page, paragraph))
    ) {
      return paragraph;
    }
  }

  return null;
}

/** placeholder 클릭 후 paragraph 생성 대기 */
export async function waitForBlogBodyParagraphLocator(
  page: Page,
  maxMs = 10_000,
): Promise<Locator | null> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isDraftResumePopupVisible(page)) {
      await sleep(200);
      continue;
    }
    const loc = await findBlogBodyParagraphOnly(page);
    if (loc) return loc;
    await sleep(120);
  }
  return null;
}

/**
 * placeholder 클릭 직후 — 빈 paragraph는 boundingBox height 0·isVisible false일 수 있음.
 * findBlogBodyParagraphOnly(isVisible + height>=16)는 이 상태를 BLOG_BODY_NOT_FOUND로 오탐한다.
 */
export async function findBlogBodyParagraphAfterClick(page: Page): Promise<Locator | null> {
  await dismissSeOneMaterialPopup(page);

  for (const scope of await editorLocatorScopes(page)) {
    const paragraphs = scope.locator(
      '.se-components-wrap .se-section-text:not(.se-section-documentTitle) .se-text-paragraph[contenteditable="true"]',
    );
    const count = await paragraphs.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const loc = paragraphs.nth(i);
      if (await isLocatorInTitleSection(loc)) continue;
      if (await isLocatorInEditorChrome(loc)) continue;
      const ok = await loc.evaluate((el) => el.matches('[contenteditable="true"]')).catch(() => false);
      if (ok) return loc;
    }

    const section = scope
      .locator('.se-components-wrap .se-section-text:not(.se-section-documentTitle)')
      .first();
    if ((await section.count().catch(() => 0)) === 0) continue;
    if (await isLocatorInTitleSection(section)) continue;
    if (await isLocatorInEditorChrome(section)) continue;
    const nested = section.locator('.se-text-paragraph[contenteditable="true"]').first();
    if ((await nested.count().catch(() => 0)) > 0) return nested;
  }

  return null;
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

/** 빈 paragraph — isLocatorMainEditorBody(height>=16) 통과 전에도 본문 입력 가능 */
async function isBodyParagraphEditable(page: Page, loc: Locator): Promise<boolean> {
  if (await isLocatorInTitleSection(loc)) return false;
  if (await isLocatorInEditorChrome(loc)) return false;
  const box = await loc.boundingBox().catch(() => null);
  if (!box || box.width < 40) return false;
  const vp = page.viewportSize();
  if (vp && box.y > vp.height * 0.85) return false;
  return loc.evaluate((el) => el.matches('[contenteditable="true"]')).catch(() => false);
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
  for (let round = 0; round < 3; round += 1) {
    let dismissed = false;

    const popup = page
      .locator('[class*="se-popup"], [class*="popup"], [class*="material"]')
      .filter({ hasText: /검색 결과가 없습니다|글감/ })
      .first();
    if (await popup.isVisible({ timeout: 250 }).catch(() => false)) {
      const closeBtn = popup
        .locator('button[aria-label*="닫"], .btn_close, button[class*="close"], button:has-text("닫기")')
        .first();
      if (await closeBtn.isVisible({ timeout: 200 }).catch(() => false)) {
        await closeBtn.click({ timeout: 3000 }).catch(() => {});
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
      dismissed = true;
      await sleep(200);
    }

    const materialInput = page.locator('input[placeholder*="글감"], input[placeholder*="검색"]').first();
    if (await materialInput.isVisible({ timeout: 200 }).catch(() => false)) {
      await page.keyboard.press('Escape').catch(() => {});
      dismissed = true;
      await sleep(200);
    }

    if (!dismissed) break;
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

  for (const scope of await editorLocatorScopes(page)) {
    const mainParagraph = await pickMainBodyParagraph(page, scope);
    if (mainParagraph) return mainParagraph;

    const bodySection = scope
      .locator('.se-components-wrap .se-section-text:not(.se-section-documentTitle)')
      .first();
    try {
      if (
        (await bodySection.count().catch(() => 0)) > 0 &&
        (await bodySection.isVisible({ timeout: 600 }).catch(() => false)) &&
        (await isLocatorBodySection(page, bodySection))
      ) {
        const paragraph = bodySection.locator('.se-text-paragraph[contenteditable="true"]').first();
        if (
          (await paragraph.count().catch(() => 0)) > 0 &&
          (await paragraph.isVisible({ timeout: 300 }).catch(() => false)) &&
          (await isLocatorMainEditorBody(page, paragraph))
        ) {
          return paragraph;
        }
        // paragraph 미생성(placeholder만) — section wrapper 반환 시 insertText noop
        return null;
      }
    } catch {
      /* ignore */
    }

    for (const sel of BLOG_BODY_SELECTORS) {
      const loc = scope.locator(sel).first();
      try {
        if (
          (await loc.count().catch(() => 0)) > 0 &&
          (await loc.isVisible().catch(() => false))
        ) {
          if (await isLocatorMainEditorBody(page, loc)) return loc;
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (await hasLegacyMainFrame(page)) {
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

/** contenteditable paragraph — wrapper readBlogTitleText 빈값 오판 방지 */
async function readEditableTitleText(editable: Locator): Promise<string> {
  return editable
    .evaluate((el) => {
      const node = el as HTMLElement;
      const clone = node.cloneNode(true) as HTMLElement;
      for (const bad of clone.querySelectorAll(
        'button, [role="button"], .se-toolbar, .se-floating-toolbar, .se-popup, .se-blind',
      )) {
        bad.remove();
      }
      for (const ph of clone.querySelectorAll('.se-placeholder, [class*="placeholder"]')) {
        ph.remove();
      }
      return (clone.innerText ?? clone.textContent ?? '').replace(/\u00a0/g, ' ').trim();
    })
    .catch(() => '')
    .then(sanitizeTitleRead);
}

/** SE ONE 제목 paragraph — locator 오판 시 page DOM 직접 읽기 */
async function readTitleFromEditorDom(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const clean = (root: HTMLElement): string => {
        const clone = root.cloneNode(true) as HTMLElement;
        for (const bad of clone.querySelectorAll(
          'button, [role="button"], .se-toolbar, .se-floating-toolbar, .se-popup, .se-blind',
        )) {
          bad.remove();
        }
        for (const ph of clone.querySelectorAll('.se-placeholder, [class*="placeholder"]')) {
          ph.remove();
        }
        return (clone.innerText ?? clone.textContent ?? '').replace(/\u00a0/g, ' ').trim();
      };

      const sections = document.querySelectorAll('.se-section-documentTitle, .se-documentTitle');
      for (const section of sections) {
        const sectionText = clean(section as HTMLElement);
        if (sectionText && !/^(제목|title)$/i.test(sectionText)) return sectionText;

        for (const node of section.querySelectorAll(
          '.se-text-paragraph[contenteditable="true"], .se-text-paragraph, .se-text, [contenteditable="true"]',
        )) {
          const t = clean(node as HTMLElement);
          if (t && !/^(제목|title)$/i.test(t)) return t;
        }
      }

      const nodes = document.querySelectorAll(
        '.se-section-documentTitle .se-text-paragraph[contenteditable="true"], .se-section-documentTitle [contenteditable="true"], .se-documentTitle [contenteditable="true"], #subjectTextBox',
      );
      for (const node of nodes) {
        const t = clean(node as HTMLElement);
        if (t && !/^(제목|title)$/i.test(t)) return t;
      }
      return '';
    })
    .catch(() => '')
    .then(sanitizeTitleRead);
}

/** editable·section·wrapper 통합 — pressSequentially 후 innerText 빈값 오탐 완화 */
async function readBlogTitleTextAll(
  page: Page,
  titleLoc: Locator,
  editable: Locator,
): Promise<string> {
  const fromDom = await readTitleFromEditorDom(page);
  if (fromDom) return fromDom;
  const fromEditable = await readEditableTitleText(editable);
  if (fromEditable) return fromEditable;
  const fromWrap = await readBlogTitleText(titleLoc);
  return sanitizeTitleRead(fromWrap);
}

/** SE ONE 본문·제목 공통 — humanPressSequentially(유니코드·글자별 WPM·오타) */
async function typeSeOneUnicodeText(
  page: Page,
  editable: Locator,
  text: string,
  humanConfig: HumanEngineConfig,
): Promise<void> {
  if (!text) return;
  if (await isFocusInTitleArea(page)) {
    throw new Error('BLOG_BODY_INSERTED_INTO_TITLE');
  }
  await humanPressSequentially(page, editable, text, humanConfig, { typos: true });
}

async function titleSectionMatchesExpected(page: Page, expected: string): Promise<boolean> {
  const sectionText = await readTitleFromEditorDom(page);
  if (!sectionText) return false;
  return titleContainsExpected(sectionText, expected) && !isDuplicatedBlogTitle(sectionText, expected);
}

/** pressSequentially 직후 placeholder가 사라지면 제목 입력된 것으로 간주 */
async function isBlogTitlePlaceholderGone(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const section = document.querySelector('.se-section-documentTitle, .se-documentTitle');
      if (!section) return false;
      const ph = section.querySelector('.se-placeholder, [class*="placeholder"]');
      if (!ph) return true;
      const el = ph as HTMLElement;
      if (el.offsetParent === null) return true;
      const style = window.getComputedStyle(el);
      return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
    })
    .catch(() => false);
}

/** verifyBlogTitleInput 보완 — 화면에 1회 입력됐으나 wrapper 검증만 실패한 경우 */
function titleAlreadyAcceptable(written: string, expected: string): boolean {
  if (verifyBlogTitleInput(written, expected)) return true;
  const w = written.replace(/\u00a0/g, ' ').trim();
  const e = expected.replace(/\u00a0/g, ' ').trim();
  if (!w || isTitlePlaceholderText(w) || !e) return false;
  if (/이어서\s*작성|작성\s*중인\s*글|배경\s*사진|제목위치|삭제취소확인/.test(w)) return false;
  const probe = Math.min(8, e.length);
  if (probe < 2) return false;
  return (
    w.length >= e.length * 0.85 &&
    w.length <= e.length * 1.15 &&
    w.includes(e.slice(0, probe))
  );
}

function isDuplicatedBlogTitle(written: string, expected: string): boolean {
  const w = written.replace(/\u00a0/g, ' ').trim();
  const e = expected.replace(/\u00a0/g, ' ').trim();
  if (!e || w.length < e.length * 1.5) return false;
  return w.startsWith(e + e) || w.includes(e + e);
}

/** 제목칸에 기대 제목이 이미 들어있는지(중복 포함) — 재삽입은 append 누적이므로 금지 판단용 */
function titleContainsExpected(written: string, expected: string): boolean {
  const w = written.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const e = expected.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!w || !e || isTitlePlaceholderText(w) || isTitleEditorChromeText(w)) return false;
  if (/이어서\s*작성|작성\s*중인\s*글/.test(w)) return false;
  if (w.includes(e)) return true;
  const probe = Math.min(Math.max(8, Math.floor(e.length * 0.6)), e.length);
  return probe >= 4 && w.includes(e.slice(0, probe));
}

/** isBlogTitleWritten 보완 — wrapper 읽기 불일치 시 길이·앞부분으로 완화 */
export function verifyBlogTitleInput(written: string, expected: string): boolean {
  if (isBlogTitleWritten(written, expected)) return true;
  const w = written.replace(/\u00a0/g, ' ').trim();
  const e = expected.replace(/\u00a0/g, ' ').trim();
  if (!w || isTitlePlaceholderText(w) || w.length < 2) return false;
  if (/이어서\s*작성|작성\s*중인\s*글|배경\s*사진|제목위치|삭제취소확인/.test(w)) return false;
  if (w.length < e.length * 0.85 || w.length > e.length * 1.2) return false;
  const probe = Math.min(6, w.length, e.length);
  if (probe < 2) return w.length >= e.length * 0.5;
  return (
    e.startsWith(w.slice(0, probe)) ||
    w.startsWith(e.slice(0, probe)) ||
    w.includes(e.slice(0, Math.min(4, e.length)))
  );
}

export async function verifyBlogTitleField(
  page: Page,
  titleLoc: Locator,
  expected: string,
): Promise<boolean> {
  const editable = await resolveTitleEditableLocator(page, titleLoc);
  const written = await readBlogTitleTextAll(page, titleLoc, editable);
  if (titleAlreadyAcceptable(written, expected)) return true;
  return verifyBlogTitleInput(written, expected);
}

/** 재시도·CAPTCHA 재개 — 제목 DOM 읽기 실패해도 placeholder 소실·부분 일치면 재입력 금지 */
export async function isBlogTitleFilledEnough(
  page: Page,
  titleLoc: Locator,
  expected: string,
): Promise<boolean> {
  const editable = await resolveTitleEditableLocator(page, titleLoc);
  const written = await readBlogTitleTextAll(page, titleLoc, editable);
  if (written && isDuplicatedBlogTitle(written, expected)) return true;

  if (await verifyBlogTitleField(page, titleLoc, expected)) return true;

  if (written && titleContainsExpected(written, expected)) return true;

  const probe = Math.min(10, expected.replace(/\s+/g, '').length);
  if (written && probe >= 4) {
    const compact = written.replace(/\s+/g, '');
    const exp = expected.replace(/\s+/g, '');
    if (compact.includes(exp.slice(0, probe))) return true;
  }

  if (await isBlogTitlePlaceholderGone(page)) {
    const dom = await readTitleFromEditorDom(page);
    if (dom && /[가-힣]{4,}/.test(dom)) {
      const probeDom = Math.min(8, expected.replace(/\s+/g, '').length);
      if (probeDom >= 4 && dom.replace(/\s+/g, '').includes(expected.replace(/\s+/g, '').slice(0, probeDom))) {
        return true;
      }
      if (dom.replace(/\s+/g, '').length >= 6) return true;
    }
  }
  return false;
}

/** 본문 입력은 끝났는데 검증만 실패한 재시도 — 제목칸에 글자만 있으면 재타이핑 금지 */
export async function shouldSkipTitleRetypeOnBodyResume(
  page: Page,
  titleLoc: Locator,
  expected: string,
): Promise<boolean> {
  if (await isBlogTitleFilledEnough(page, titleLoc, expected)) return true;
  const editable = await resolveTitleEditableLocator(page, titleLoc);
  const written = await readBlogTitleTextAll(page, titleLoc, editable);
  if (!written || isTitlePlaceholderText(written) || isTitleEditorChromeText(written)) return false;
  if (isDuplicatedBlogTitle(written, expected)) return true;
  if (titleContainsExpected(written, expected)) return true;
  const compact = written.replace(/\s+/g, '');
  const exp = expected.replace(/\s+/g, '');
  if (compact.length >= 6 && exp.length >= 4 && compact.includes(exp.slice(0, Math.min(8, exp.length)))) {
    return true;
  }
  return compact.length >= 8 && /[가-힣]{4,}/.test(written);
}

/** 링크·이미지 삽입 직전 — 제목 blur 후 본문 끝 캐럿 */
export async function focusBlogBodyAtEnd(page: Page, bodyLoc: Locator): Promise<void> {
  await blurBlogTitleField(page);
  const editable = await resolveBodyEditableLocatorRelaxed(bodyLoc);
  await focusBodyEditableNode(editable);
  await page.keyboard.press('Control+End');
  await sleep(150);
}

/** 링크·이미지 삽입 후 — locator stale·OG DOM 갱신으로 verifyBlogTitleField 오탐 방지 */
export async function ensureBlogTitleBeforeReview(
  page: Page,
  titleLoc: Locator,
  expected: string,
  humanConfig: HumanEngineConfig,
): Promise<void> {
  let loc = titleLoc;
  for (let i = 0; i < 5; i += 1) {
    const fresh = await findBlogTitleLocator(page);
    if (fresh) loc = fresh;
    if (await verifyBlogTitleField(page, loc, expected)) return;
    await sleep(350);
  }

  const dom = await readTitleFromEditorDom(page);
  if (titleContainsExpected(dom, expected) && !isDuplicatedBlogTitle(dom, expected)) {
    return;
  }
  if (dom && dom.replace(/\s+/g, '').length >= 6 && /[가-힣]/.test(dom)) {
    return;
  }

  await ensureBlogTitleWritten(page, loc, expected, humanConfig);
  if (await verifyBlogTitleField(page, loc, expected)) return;

  throw new Error('BLOG_TITLE_LOST_BEFORE_REVIEW');
}

/** insertText 직후 DOM 반영 대기 — 팝업 취소 직후 readBlogTitleText 빈값 방지 */
export async function waitForBlogTitleWritten(
  page: Page,
  titleLoc: Locator,
  expected: string,
  maxMs = 2000,
): Promise<boolean> {
  const editable = await resolveTitleEditableLocator(page, titleLoc);
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const written = await readBlogTitleTextAll(page, titleLoc, editable);
    if (titleAlreadyAcceptable(written, expected)) return true;
    if (verifyBlogTitleInput(written, expected)) return true;
    await sleep(120);
  }
  return verifyBlogTitleField(page, titleLoc, expected);
}

/** 제목 1회 입력 확정 — IME 타이핑. 기대 제목이 이미 있으면 재입력 금지 */
export async function ensureBlogTitleWritten(
  page: Page,
  titleLoc: Locator,
  text: string,
  humanConfig: HumanEngineConfig,
): Promise<void> {
  const editable = await resolveTitleEditableLocator(page, titleLoc);
  const domWritten = await readBlogTitleTextAll(page, titleLoc, editable);

  if (await isBlogTitleFilledEnough(page, titleLoc, text)) {
    await blurBlogTitleField(page);
    return;
  }

  if (titleContainsExpected(domWritten, text) && !isDuplicatedBlogTitle(domWritten, text)) {
    await blurBlogTitleField(page);
    return;
  }
  if (domWritten && isDuplicatedBlogTitle(domWritten, text)) {
    await blurBlogTitleField(page);
    return;
  }
  await typeBlogTitleField(page, titleLoc, text, humanConfig);
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
  return resolveBodyEditableLocatorRelaxed(bodyLoc);
}

/** SE ONE — components-wrap 안 마지막 contenteditable paragraph */
async function focusLastBodyParagraphViaDom(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const all = document.querySelectorAll(
        '.se-components-wrap .se-text-paragraph[contenteditable="true"], .se-main-container .se-text-paragraph[contenteditable="true"]',
      );
      const target = all.length > 0 ? (all[all.length - 1] as HTMLElement) : null;
      if (!target) return false;
      if (target.closest('.se-section-documentTitle, .se-documentTitle')) return false;
      target.scrollIntoView({ block: 'end' });
      target.focus();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return true;
    })
    .catch(() => false);
}

async function focusCaretAtLocatorEnd(loc: Locator): Promise<boolean> {
  return loc
    .evaluate((el) => {
      const node = el as HTMLElement;
      const target = node.matches('[contenteditable="true"]')
        ? node
        : (node.querySelector('[contenteditable="true"]') as HTMLElement | null);
      if (!target) return false;
      target.scrollIntoView({ block: 'end' });
      target.focus();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return true;
    })
    .catch(() => false);
}

async function resolveBodyEditableLocatorLast(page: Page, bodyLoc: Locator): Promise<Locator> {
  const inSection = bodyLoc.locator('.se-text-paragraph[contenteditable="true"]').last();
  if ((await inSection.count()) > 0) return inSection;
  const globalLast = page
    .locator('.se-components-wrap .se-text-paragraph[contenteditable="true"]')
    .last();
  if ((await globalLast.count()) > 0) return globalLast;
  return resolveBodyEditableLocatorRelaxed(bodyLoc);
}

/** 본문 맨 끝으로 캐럿 이동 — 마우스는 마지막 줄 우측만 (중앙 클릭 금지) */
export async function focusBlogBodyEnd(page: Page, bodyLoc: Locator): Promise<void> {
  await blurBlogTitleField(page);

  if (await isFocusInBodyArea(page)) {
    await page.keyboard.press('End');
    await sleep(60);
    await page.keyboard.press('End');
    await sleep(60);
    await page.keyboard.press('Control+End');
    await sleep(60);
    if (!(await isFocusInTitleArea(page))) return;
  }

  if (await focusLastBodyParagraphViaDom(page)) {
    await sleep(100);
    await page.keyboard.press('End');
    await sleep(60);
    if (!(await isFocusInTitleArea(page))) return;
  }

  const lastPara = page
    .locator('.se-components-wrap .se-text-paragraph[contenteditable="true"]')
    .last();
  const paraBox = await lastPara.boundingBox().catch(() => null);
  if (paraBox && paraBox.width > 12) {
    const x = paraBox.x + paraBox.width - 4;
    const y = paraBox.y + paraBox.height / 2;
    await humanMouseMove(page, x, y);
    await sleep(80);
    await page.mouse.click(x, y);
    await sleep(120);
    await page.keyboard.press('End');
    await sleep(60);
    if (!(await isFocusInTitleArea(page))) return;
  }

  const lastEditable = await resolveBodyEditableLocatorLast(page, bodyLoc);
  if (await focusCaretAtLocatorEnd(lastEditable)) {
    await sleep(100);
    await page.keyboard.press('End');
    await sleep(60);
    if (!(await isFocusInTitleArea(page))) return;
  }

  await page.keyboard.press('Control+End');
  await sleep(100);
  if (await isFocusInTitleArea(page)) {
    throw new Error('BLOG_BODY_INSERTED_INTO_TITLE');
  }
  if (await isFocusInBodyArea(page)) return;

  throw new Error('BLOG_BODY_END_FOCUS_FAILED');
}

/** 본문 insertText 직후 — 클릭 없이 키보드만으로 줄 끝 */
export async function moveCaretToBodyTailAfterPaste(page: Page): Promise<void> {
  await blurBlogTitleField(page);
  if (await isFocusInBodyArea(page)) {
    await page.keyboard.press('End');
    await sleep(60);
    await page.keyboard.press('End');
    await sleep(60);
    return;
  }
}

/** 본문 섹션 전체 텍스트 (링크 URL 검증용) */
export async function readBlogBodySectionText(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const wraps = document.querySelectorAll(
        '.se-components-wrap .se-section-text:not(.se-section-documentTitle)',
      );
      const parts: string[] = [];
      for (const wrap of Array.from(wraps)) {
        const clone = (wrap as HTMLElement).cloneNode(true) as HTMLElement;
        for (const ph of clone.querySelectorAll('.se-placeholder, [class*="placeholder"]')) {
          ph.remove();
        }
        const t = (clone.innerText ?? clone.textContent ?? '').replace(/\u00a0/g, ' ').trim();
        if (t) parts.push(t);
      }
      return parts.join('\n').trim();
    })
    .catch(() => '');
}

export function isBlogLinkUrlInBodyText(bodyText: string, linkUrl: string): boolean {
  const normalized = bodyText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const url = linkUrl.trim();
  if (!url) return false;
  if (normalized.includes(url)) return true;
  try {
    const host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
    if (host && normalized.includes(host)) return true;
  } catch {
    /* ignore */
  }
  return /yeonun\.(com|ai)/i.test(normalized);
}

/** 본문 섹션 — 업로드 중·placeholder 이미지 모듈 (naturalWidth 미확정) */
export async function isBlogImageModuleInBodySection(page: Page): Promise<boolean> {
  return page
    .evaluate((bodySel) => {
      const section = document.querySelector(bodySel);
      if (!section) return false;
      const modules = section.querySelectorAll(
        '.se-module-image, .se-component-image, [data-module="image"], .se-image-resource',
      );
      for (const mod of modules) {
        const el = mod as HTMLElement;
        if (el.offsetWidth >= 40 && el.offsetHeight >= 40) return true;
        if (el.querySelector('img, .se-image, [class*="image"]')) return true;
      }
      return false;
    }, BLOG_BODY_SECTION_LOCATOR)
    .catch(() => false);
}

/** 본문 섹션 안에만 이미지 모듈 존재 여부 (툴바 se-image·깨진 placeholder 제외) */
export async function isBlogImageInBodySection(page: Page): Promise<boolean> {
  return page
    .evaluate((bodySel) => {
      const section = document.querySelector(bodySel);
      if (!section) return false;
      const imgs = section.querySelectorAll(
        '.se-module-image img, .se-component-image img, [data-module="image"] img, .se-image img',
      );
      for (const img of imgs) {
        const el = img as HTMLImageElement;
        if (el.naturalWidth >= 32 && el.naturalHeight >= 32) return true;
        const w = el.offsetWidth || el.clientWidth;
        const h = el.offsetHeight || el.clientHeight;
        if (w >= 48 && h >= 48 && el.src && !/^data:$/i.test(el.src)) return true;
      }
      return false;
    }, BLOG_BODY_SECTION_LOCATOR)
    .catch(() => false);
}

export async function isBlogImagePresentInBody(page: Page): Promise<boolean> {
  if (await isBlogImageInBodySection(page)) return true;
  return isBlogImageModuleInBodySection(page);
}

/** 재시도·CAPTCHA 재개 — 현재 job 제목·본문과 임시저장 초안이 일치하면 이어쓰기(확인) */
export async function shouldResumeDraftForJob(
  page: Page,
  expectedTitle: string,
  expectedContent?: string,
): Promise<boolean> {
  const titleLoc = await findBlogTitleLocator(page);
  if (titleLoc) {
    const editable = await resolveTitleEditableLocator(page, titleLoc);
    const written = await readBlogTitleTextAll(page, titleLoc, editable);
    if (written && isDuplicatedBlogTitle(written, expectedTitle)) return true;
    if (written && titleContainsExpected(written, expectedTitle)) return true;
  }
  const content = expectedContent?.trim();
  if (content) {
    const body = await readBlogBodySectionText(page);
    if (isBlogBodySubstantiallyWritten(body, content)) return true;
  }
  return false;
}

/** postwrite 탭에 제목·본문이 이미 채워졌는지 — 재진입 시 임시저장 취소·제목 재입력 방지 */
export async function hasExistingBlogEditorContent(page: Page): Promise<boolean> {
  const bodyText = await readBlogBodySectionText(page);
  if (bodyText.replace(/\s+/g, '').length >= 40) return true;
  if (await isBlogImagePresentInBody(page)) return true;

  const titleLoc = await findBlogTitleLocator(page);
  if (!titleLoc) return false;
  const editable = await resolveTitleEditableLocator(page, titleLoc);
  const written = await readBlogTitleTextAll(page, titleLoc, editable);
  return Boolean(
    written &&
      written.replace(/\s+/g, '').length >= 4 &&
      !isTitlePlaceholderText(written) &&
      !isTitleEditorChromeText(written),
  );
}

/** placeholder 클릭 직후 — 빈 paragraph는 isVisible false일 수 있어 attached만 확인 */
async function resolveBodyEditableLocatorRelaxed(bodyLoc: Locator): Promise<Locator> {
  const paragraph = bodyLoc.locator('.se-text-paragraph[contenteditable="true"]').first();
  if ((await paragraph.count()) > 0) return paragraph;
  const nested = bodyLoc.locator('[contenteditable="true"], [contenteditable]').first();
  if ((await nested.count()) > 0) return nested;
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
  if (!e) return b.length >= 60;
  const minLen = Math.min(60, Math.max(20, Math.floor(e.length * 0.45)));
  if (b.length < minLen) return false;
  const probe = Math.min(48, e.length);
  if (b.includes(e.slice(0, probe)) || e.includes(b.slice(0, Math.min(probe, b.length)))) {
    return true;
  }
  const bCompact = b.replace(/\s+/g, '');
  const eCompact = e.replace(/\s+/g, '');
  const shortProbe = Math.min(24, eCompact.length);
  if (shortProbe >= 10 && bCompact.includes(eCompact.slice(0, shortProbe))) return true;
  if (e.length >= 200 && b.length >= Math.floor(e.length * 0.38)) return true;
  return false;
}

export async function verifyBlogBodyField(
  page: Page,
  bodyLoc: Locator,
  expected: string,
): Promise<boolean> {
  const written = await readBlogBodySectionText(page);
  if (isBlogBodySubstantiallyWritten(written, expected)) return true;
  const editable = await resolveBodyEditableLocator(bodyLoc);
  const fallback = await readBlogBodyText(editable);
  return isBlogBodySubstantiallyWritten(fallback, expected);
}

/** insertText 직후 DOM 반영 대기 — placeholder 클릭 직후 readBlogBodyText 빈값 방지 */
export async function waitForBlogBodyWritten(
  page: Page,
  bodyLoc: Locator,
  expected: string,
  maxMs = 3000,
): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await verifyBlogBodyField(page, bodyLoc, expected)) return true;
    await sleep(100);
  }
  return verifyBlogBodyField(page, bodyLoc, expected);
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

export async function focusBlogBodyField(page: Page, bodyLoc: Locator, maxAttempts = 2): Promise<void> {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (await isDraftResumePopupVisible(page)) {
      await sleep(200);
      continue;
    }
    await blurBlogTitleField(page);
    await dismissSeOneMaterialPopup(page);

    const paragraph =
      (await findBlogBodyParagraphOnly(page)) ?? (await resolveBodyEditableLocator(bodyLoc));
    await paragraph.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await humanClickLocator(page, paragraph);
    await sleep(200);
    await focusBodyEditableNode(paragraph);

    if (!(await isFocusInTitleArea(page))) return;
  }
  throw new Error('BLOG_BODY_WRITE_FAILED');
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

/** 제목 입력 직후 — 포인터를 본문 placeholder로 이동(blur만, 클릭은 clickBlogBodyPlaceholder) */
export async function moveMouseToBlogPlaceholder(page: Page, titleLoc?: Locator | null): Promise<void> {
  await blurBlogTitleField(page);
  await dismissSeOneMaterialPopup(page);

  const byText = page
    .locator(
      '.se-section-text:not(.se-section-documentTitle) .se-placeholder, .se-section-text:not(.se-section-documentTitle) [class*="placeholder"]',
    )
    .filter({ hasText: /글감과 함께|나의 일상을 기록/ })
    .first();
  if (await byText.isVisible({ timeout: 1500 }).catch(() => false)) {
    const box = await byText.boundingBox().catch(() => null);
    if (box) {
      await humanMouseMove(page, box.x + box.width / 2, box.y + Math.min(Math.max(box.height / 2, 20), 36));
      return;
    }
  }

  const title = titleLoc ?? (await findBlogTitleLocator(page));
  if (!title) return;
  const box = await title.boundingBox().catch(() => null);
  if (!box) return;
  await humanMouseMove(page, box.x + box.width / 2, box.y + box.height + 72);
}

/** 본문 placeholder — 「글감과 함께 나의 일상을 기록해보세요!」 마우스 클릭 */
export async function clickBlogBodyPlaceholder(page: Page): Promise<void> {
  if (await isDraftResumePopupVisible(page)) {
    throw new Error('DRAFT_RESUME_POPUP_STILL_VISIBLE');
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

async function logTitleDebug(message: string): Promise<void> {
  await logOperation({ level: 'info', message: `[post_blog][title] ${message}` }).catch(() => {});
}

async function pastePlainTextAtCaret(page: Page, text: string): Promise<void> {
  const plain = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.evaluate(async (t) => {
    await navigator.clipboard.writeText(t);
  }, plain);
  await sleep(randomBetween(80, 200));
  await page.keyboard.press('Control+v');
  await sleep(randomBetween(400, 900));
}

function titleVerifyTimeoutMs(text: string): number {
  return Math.min(120_000, Math.max(10_000, text.length * 100));
}

/**
 * SE ONE 제목 — 1회 클릭·pressSequentially 후 본문으로 blur (insertText·재타이핑 없음).
 */
export async function typeBlogTitleField(
  page: Page,
  titleLoc: Locator,
  text: string,
  humanConfig: HumanEngineConfig,
): Promise<void> {
  if (await isDraftResumePopupVisible(page)) {
    throw new Error('DRAFT_RESUME_POPUP_STILL_VISIBLE');
  }

  const titleText = truncateBlogTitle(text);
  if (await isBlogTitleFilledEnough(page, titleLoc, titleText)) {
    await blurBlogTitleField(page);
    return;
  }

  const editable = await resolveTitleEditableLocator(page, titleLoc);
  await editable.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});

  let current = await readBlogTitleTextAll(page, titleLoc, editable);
  if (isLikelyDubeolsikGarbage(current, titleText)) current = '';
  if (!current.trim() && (await isBlogTitlePlaceholderGone(page))) {
    current = (await readTitleFromEditorDom(page)).trim();
  }
  const dup = isDuplicatedBlogTitle(current, titleText);
  await logTitleDebug(`진입 현재값="${current}" 중복=${dup}`);

  if (dup) {
    await blurBlogTitleField(page);
    await logTitleDebug('제목 중복 — 재입력 생략');
    return;
  }

  if (titleContainsExpected(current, titleText)) {
    await blurBlogTitleField(page);
    return;
  }

  const domTitleEarly = (await readTitleFromEditorDom(page)).trim();
  if (domTitleEarly.length >= 8 && /[가-힣]{4,}/.test(domTitleEarly)) {
    if (
      titleContainsExpected(domTitleEarly, titleText) ||
      isDuplicatedBlogTitle(domTitleEarly, titleText)
    ) {
      await blurBlogTitleField(page);
      await logTitleDebug(`제목 DOM "${domTitleEarly.slice(0, 24)}…" — 재입력 생략`);
      return;
    }
    const probe = Math.min(8, titleText.replace(/\s+/g, '').length);
    if (
      probe >= 4 &&
      domTitleEarly.replace(/\s+/g, '').includes(titleText.replace(/\s+/g, '').slice(0, probe))
    ) {
      await blurBlogTitleField(page);
      await logTitleDebug('제목 DOM 앞부분 일치 — 재입력 생략');
      return;
    }
  }

  if (await isBlogTitlePlaceholderGone(page)) {
    const domTitle = (await readTitleFromEditorDom(page)).trim();
    if (domTitle.length >= 6 && /[가-힣]/.test(domTitle)) {
      await blurBlogTitleField(page);
      await logTitleDebug(`제목 DOM ${domTitle.length}자 — 재입력·클릭 생략`);
      return;
    }
  }

  await humanClickLocator(page, editable);
  await sleep(humanBriefPauseMs(humanConfig));

  if (current) {
    await clearTitleFieldThoroughly(page, editable);
  }
  await focusTitleEditableNode(editable);

  await logTitleDebug(`pressSequentially 시작 (${titleText.length}자·wpm≈${humanConfig.wpm_mean})`);
  await humanPressSequentially(page, editable, titleText, humanConfig, { typos: true });
  await sleep(humanBriefPauseMs(humanConfig, 0.12, 0.28));

  await waitForBlogTitleWritten(page, titleLoc, titleText, Math.min(8_000, titleVerifyTimeoutMs(titleText)));

  const after = await readBlogTitleTextAll(page, titleLoc, editable);
  await logTitleDebug(`타이핑 후="${after}"`);

  if (
    (titleContainsExpected(after, titleText) && !isDuplicatedBlogTitle(after, titleText)) ||
    (await titleSectionMatchesExpected(page, titleText))
  ) {
    await blurBlogTitleField(page);
    await logTitleDebug('제목 입력 확정 — 본문으로 blur');
    return;
  }

  if (await isBlogTitlePlaceholderGone(page)) {
    await blurBlogTitleField(page);
    await logTitleDebug('placeholder 사라짐 — pressSequentially 성공으로 간주');
    return;
  }

  throw new Error('BLOG_TITLE_WRITE_FAILED');
}

/** @deprecated typeBlogTitleField 사용 */
export async function pasteBlogTitleField(
  page: Page,
  titleLoc: Locator,
  text: string,
  humanConfig: HumanEngineConfig,
): Promise<void> {
  await typeBlogTitleField(page, titleLoc, text, humanConfig);
}

async function ensureBodyFocusForPaste(page: Page, editable: Locator): Promise<void> {
  if (!(await isFocusInTitleArea(page))) return;
  await blurBlogTitleField(page);
  await focusBodyEditableNode(editable);
  if (await isFocusInTitleArea(page)) {
    throw new Error('BLOG_BODY_INSERTED_INTO_TITLE');
  }
}

/** 본문 타이핑 직전 — 제목 blur 후 본문 editable 포커스 확정 (placeholder 클릭만으로는 부족할 수 있음) */
export async function ensureBlogBodyFocusForTyping(page: Page, bodyLoc: Locator): Promise<Locator> {
  await blurBlogTitleField(page);
  const editable = await resolveBodyEditableLocator(bodyLoc);
  if ((await isFocusInTitleArea(page)) || !(await isFocusInBodyArea(page))) {
    await humanClickLocator(page, editable);
    await sleep(200);
    await focusBodyEditableNode(editable);
    await ensureBodyFocusForPaste(page, editable);
  }
  if (await isFocusInTitleArea(page)) {
    throw new Error('BLOG_BODY_INSERTED_INTO_TITLE');
  }
  return editable;
}

/**
 * SE ONE 본문 입력.
 * afterPlaceholderClick: placeholder humanClick 직후 — 재탐색·재클릭 없이 insertText만.
 */
export async function pasteBlogBodyContent(
  page: Page,
  bodyLoc: Locator,
  content: string,
  options?: { skipClick?: boolean; afterPlaceholderClick?: boolean },
): Promise<void> {
  if (await isDraftResumePopupVisible(page)) {
    throw new Error('DRAFT_RESUME_POPUP_STILL_VISIBLE');
  }

  if (options?.afterPlaceholderClick) {
    await ensureBlogBodyFocusForTyping(page, bodyLoc);
  } else {
    const editable = await resolveBodyEditableLocator(bodyLoc);
    if (options?.skipClick) {
      if (await isFocusInTitleArea(page)) {
        await blurBlogTitleField(page);
      }
      await humanClickLocator(page, editable);
      await sleep(200);
    } else {
      await ensureBlogBodyFocusForTyping(page, bodyLoc);
    }
  }

  if (await isFocusInTitleArea(page)) {
    throw new Error('BLOG_BODY_INSERTED_INTO_TITLE');
  }

  const paragraphs = content.split('\n\n').filter(Boolean);
  if (paragraphs.length === 0) {
    throw new Error('BLOG_BODY_WRITE_FAILED');
  }

  for (let i = 0; i < paragraphs.length; i += 1) {
    if (await isFocusInTitleArea(page)) {
      await blurBlogTitleField(page);
      const editable = await resolveBodyEditableLocatorRelaxed(bodyLoc);
      await humanClickLocator(page, editable);
      await sleep(150);
      await focusBodyEditableNode(editable);
      if (await isFocusInTitleArea(page)) {
        throw new Error('BLOG_BODY_INSERTED_INTO_TITLE');
      }
    }
    await page.keyboard.insertText(paragraphs[i]!);
    await sleep(200);
    if (i < paragraphs.length - 1) {
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await sleep(150);
    }
  }

  if (!(await waitForBlogBodyWritten(page, bodyLoc, content, 3500))) {
    throw new Error('BLOG_BODY_WRITE_FAILED');
  }
}

/**
 * SE ONE 본문 — paste_ratio 단락 복붙 · 나머지 pressSequentially(유니코드).
 * afterPlaceholderClick: placeholder humanClick 직후 — 재탐색·재클릭 없이 캐럿 유지.
 */
export async function typeBlogBodyContent(
  page: Page,
  bodyLoc: Locator,
  content: string,
  humanConfig: HumanEngineConfig,
  options?: {
    skipClick?: boolean;
    afterPlaceholderClick?: boolean;
    onAfterParagraph?: (paragraphIndex: number) => Promise<void>;
  },
): Promise<void> {
  if (await isDraftResumePopupVisible(page)) {
    throw new Error('DRAFT_RESUME_POPUP_STILL_VISIBLE');
  }

  if (options?.afterPlaceholderClick) {
    await ensureBlogBodyFocusForTyping(page, bodyLoc);
  } else if (options?.skipClick) {
    const editable = await resolveBodyEditableLocator(bodyLoc);
    if (await isFocusInTitleArea(page)) {
      await blurBlogTitleField(page);
    }
    await humanClickLocator(page, editable);
    await sleep(200);
  } else {
    await ensureBlogBodyFocusForTyping(page, bodyLoc);
  }

  if (await isFocusInTitleArea(page)) {
    throw new Error('BLOG_BODY_INSERTED_INTO_TITLE');
  }

  const paragraphs = content.split('\n\n').filter(Boolean);
  if (paragraphs.length === 0) {
    throw new Error('BLOG_BODY_WRITE_FAILED');
  }

  const pasteRatio = resolvePasteRatio(humanConfig);
  const pasteCount = Math.floor(paragraphs.length * pasteRatio);
  const pasteIndices = new Set<number>();
  while (pasteIndices.size < pasteCount) {
    pasteIndices.add(Math.floor(Math.random() * paragraphs.length));
  }

  let focused = true;

  for (let i = 0; i < paragraphs.length; i += 1) {
    const editable = await resolveBodyEditableLocatorRelaxed(bodyLoc);
    if (!focused) {
      await focusBodyEditableNode(editable);
      focused = true;
    }

    if (await isFocusInTitleArea(page)) {
      await blurBlogTitleField(page);
      await humanClickLocator(page, editable);
      await sleep(150);
      await focusBodyEditableNode(editable);
      if (await isFocusInTitleArea(page)) {
        throw new Error('BLOG_BODY_INSERTED_INTO_TITLE');
      }
    }

    const para = paragraphs[i]!;

    if (pasteIndices.has(i)) {
      const plan = planParagraphPaste(para);
      const segments = plan.hasPaste ? plan.segments : [{ kind: 'paste' as const, text: para }];
      for (const seg of segments) {
        if (seg.kind === 'paste') {
          await pastePlainTextAtCaret(page, seg.text);
          focused = true;
        } else {
          await typeSeOneUnicodeText(page, editable, seg.text, humanConfig);
          focused = true;
        }
      }
    } else {
      await typeSeOneUnicodeText(page, editable, para, humanConfig);
      focused = true;
    }

    if (i < paragraphs.length - 1) {
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await humanSleep(humanConfig.paragraph_pause_ms[0], humanConfig.paragraph_pause_ms[1]);
    }

    if (options?.onAfterParagraph) {
      await options.onAfterParagraph(i);
    }
  }

  const verifyMs = Math.min(30_000, Math.max(8000, content.length * 40));
  if (!(await waitForBlogBodyWritten(page, bodyLoc, content, verifyMs))) {
    const sectionText = await readBlogBodySectionText(page);
    if (isBlogBodySubstantiallyWritten(sectionText, content)) {
      await logOperation({
        level: 'info',
        message: `[post_blog][body] 검증 완화 통과 (${sectionText.length}자) — 링크·이미지 단계로 진행`,
      }).catch(() => {});
      return;
    }
    throw new Error('BLOG_BODY_WRITE_FAILED');
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

/** 본문란 확보 — contenteditable paragraph만 반환 */
export async function ensureBlogBodyLocator(
  page: Page,
  titleLoc?: Locator | null,
): Promise<Locator | null> {
  if (await isDraftResumePopupVisible(page)) return null;

  const title = titleLoc ?? (await findBlogTitleLocator(page));
  for (let i = 0; i < 5; i += 1) {
    await prepareSeOneEditorSurfaceForBody(page);
    const loc = await findBlogBodyParagraphOnly(page);
    if (loc) return loc;
    await clickSeOneBodyPlaceholder(page, title);
    await sleep(350);
  }
  return waitForBlogBodyParagraphLocator(page, 2000);
}

async function prepareSeOneEditorSurfaceForBody(page: Page): Promise<void> {
  await dismissSeOneHelpPanel(page);
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

/**
 * 제목 editable 비움 — Ctrl+A·Backspace 후 잔여는 키 삭제.
 */
async function clearTitleFieldThoroughly(page: Page, editable: Locator): Promise<boolean> {
  await focusTitleEditableNode(editable);
  await page.keyboard.press('Control+a');
  await sleep(60);
  await page.keyboard.press('Backspace');
  await sleep(100);

  let remaining = await readEditableTitleText(editable);
  if (!remaining || isTitlePlaceholderText(remaining)) return true;

  return clearTitleFieldViaKeyboard(page, editable);
}

/**
 * 제목 editable 비움 — SE ONE은 JS selection·raw-DOM 삭제를 무시하므로(검증됨) 실제 키로만 삭제.
 * 가벼운 bounded 방식: 빈 칸이면 키 입력 0회, 내용 있으면 최대 2패스·패스당 ≤120키(캐럿 멈춤·폭주 방지).
 */
async function clearTitleFieldViaKeyboard(page: Page, editable: Locator): Promise<boolean> {
  for (let pass = 0; pass < 2; pass += 1) {
    const before = await readEditableTitleText(editable);
    if (!before || isTitlePlaceholderText(before)) return true;

    await focusTitleEditableNode(editable);
    await page.keyboard.press('End');
    const presses = Math.min(before.length + 4, 120);
    for (let i = 0; i < presses; i += 1) {
      await page.keyboard.press('Backspace');
    }
    await sleep(80);
  }
  const final = await readEditableTitleText(editable);
  return !final || isTitlePlaceholderText(final);
}

/** SE ONE 제목 — typeBlogTitleField 위임 */
export async function typeTextIntoBlogTitleField(
  page: Page,
  titleLoc: Locator,
  text: string,
  humanConfig: HumanEngineConfig,
): Promise<void> {
  await typeBlogTitleField(page, titleLoc, text, humanConfig);
}

export async function findVisibleLocator(
  page: Page,
  selectors: string[],
  options?: { inFrame?: boolean },
): Promise<Locator | null> {
  const scopes: Array<Page | FrameLocator> =
    options?.inFrame === false ? [page] : await editorLocatorScopes(page);

  for (const scope of scopes) {
    for (const sel of selectors) {
      const loc = scope.locator(sel).first();
      try {
        if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
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

  for (const label of ariaLabels) {
    for (const scope of await editorLocatorScopes(page)) {
      const loc = scope.getByRole('button', { name: label }).first();
      try {
        if (
          (await loc.count().catch(() => 0)) > 0 &&
          (await loc.isVisible().catch(() => false))
        ) {
          await clickVisibleLocator(page, loc);
          return true;
        }
      } catch {
        /* ignore */
      }
    }
  }

  for (const text of buttonTexts) {
    for (const scope of await editorLocatorScopes(page)) {
      const loc = scope.locator(`button:has-text("${text}")`).first();
      try {
        if (
          (await loc.count().catch(() => 0)) > 0 &&
          (await loc.isVisible().catch(() => false))
        ) {
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
