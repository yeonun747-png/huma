import type { BrowserContext, Page } from 'playwright';

import { humanClickLocator, humanMouseMove } from '../../human-engine/mouse.js';
import { humanSleep } from '../../human-engine/typing.js';

import type { HumanEngineConfig } from '../../../lib/settings.js';

import { notifySlack } from '../../watcher/detector.js';

import { vncFastSleepScale } from '../../../lib/vnc-session.js';
import { PLAYWRIGHT_NAV_TIMEOUT_MS } from '../../../lib/playwright-nav-timeout.js';
import { sleep } from '../../../lib/utils.js';
import { logOperation } from '../../../lib/log-emitter.js';
import { supabase } from '../../../middleware/auth.js';
import {
  BLOG_BODY_SELECTORS,
  BLOG_TITLE_SELECTORS,
  dismissSeOneMaterialPopup,
  dismissSeOneHelpPanel,
  findBlogTitleLocator,
  findVisibleLocator,
  editorLocatorScopes,
  isDraftResumePopupVisible,
  isNaverBlogEditorInteractable,
  isSeOneEditorShellReady,
  shouldResumeDraftForJob,
} from './naver-editor-locators.js';

function scaledSleep(min: number, max: number): Promise<void> {
  const s = vncFastSleepScale();
  return humanSleep(Math.round(min * s), Math.round(max * s));
}

const BLOG_ID_RE = /blog\.naver\.com\/([A-Za-z0-9_-]+)(?:[/?#]|$)/;
const RESERVED_BLOG_PATHS = new Set([
  'PostWriteForm',
  'PostList',
  'GoBlogWrite',
  'BlogHome',
  'PostView',
  'section',
]);
const POSTWRITE_URL_RE = /postwrite|PostWriteForm|GoBlogWrite/i;

/** VNC/Xvfb — SmartEditor ONE 초기 로딩·도움말 오버레이 대기 */
const SMART_EDITOR_WAIT_MS = 180_000;
const EDITOR_POLL_MS = 1_200;

const TITLE_EDITOR_SELECTORS = BLOG_TITLE_SELECTORS;

const CONTENT_EDITOR_SELECTORS = BLOG_BODY_SELECTORS;

const LEGACY_HELP_CLOSE_SELECTORS = [
  '.se-help-panel-close-button',
  'button.se-help-panel-close-button',
  '.btn_close_help',
  '.se-help-panel button[aria-label="닫기"]',
  '.se-help-panel button[class*="close"]',
  '.se-guide-close-button',
  '.se-onboarding-close-button',
  'button:has-text("닫기")',
  'button:has-text("그만보기")',
  'button:has-text("다시 보지 않기")',
];

function blogIdFromUrl(url: string): string | null {
  if (url.includes('section.blog') || /BlogHome/i.test(url)) return null;
  const id = url.match(BLOG_ID_RE)?.[1];
  if (!id || RESERVED_BLOG_PATHS.has(id) || /\.naver$/i.test(id)) return null;
  return id;
}

async function loadBlogIdFromAccount(accountId: string): Promise<string | null> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('naver_id, blog_url')
    .eq('id', accountId)
    .maybeSingle();
  const fromUrl = (data?.blog_url as string | undefined)?.match(BLOG_ID_RE)?.[1];
  if (fromUrl && !RESERVED_BLOG_PATHS.has(fromUrl)) return fromUrl;
  const nid = (data?.naver_id as string | undefined)?.trim();
  return nid || null;
}

/** 이미 열린 postwrite 탭이 있으면 그 탭에서 에디터 로딩만 대기 (재네비게이션·재로그인 금지) */
export function findNaverPostwritePage(context: BrowserContext): Page | undefined {
  return context.pages().find((p) => !p.isClosed() && POSTWRITE_URL_RE.test(p.url()));
}

async function clickIfVisible(root: Page | ReturnType<Page['frameLocator']>, selector: string): Promise<boolean> {
  const loc = root.locator(selector).first();
  if (await loc.isVisible({ timeout: 600 }).catch(() => false)) {
    await loc.click({ timeout: 4000 }).catch(() => {});
    return true;
  }
  return false;
}

type DraftDismissGuard = { inFlight: boolean; cooledUntil: number };
const draftDismissGuardByPage = new WeakMap<Page, DraftDismissGuard>();

/** 팝업 취소 직후 — 제목칸이 보이면 포인터를 곧바로 제목으로 이동(best-effort, 클릭 없음) */
async function moveMouseToTitleIfReady(editorPage: Page): Promise<void> {
  try {
    const title = await findBlogTitleLocator(editorPage);
    if (!title) return;
    const box = await title.boundingBox().catch(() => null);
    if (!box || box.height < 8 || box.width < 24) return;
    await humanMouseMove(editorPage, box.x + box.width / 2, box.y + box.height / 2);
  } catch {
    /* best-effort */
  }
}

/** 팝업 취소 완료 후 가드 해제 — 로딩 대기 루프가 즉시 재개되도록 */
export function resetDraftDismissGuard(editorPage: Page): void {
  draftDismissGuardByPage.delete(editorPage);
}

function draftResumePopupRoot(editorPage: Page) {
  return editorPage
    .locator('[class*="se-popup"], [role="dialog"]')
    .filter({ hasText: /작성\s*중인\s*글|이어서\s*작성/ })
    .first();
}

async function clickDraftResumePopupButton(
  editorPage: Page,
  label: '취소' | '확인',
): Promise<boolean> {
  if (!(await isDraftResumePopupVisible(editorPage))) return false;

  const popup = draftResumePopupRoot(editorPage);
  const classHint = label === '취소' ? 'cancel' : 'confirm';
  const candidates = [
    popup.locator(`button.se-popup-button-${classHint}`).first(),
    popup.locator(`.se-popup-button-${classHint}`).first(),
    popup.getByRole('button', { name: label, exact: true }).first(),
    editorPage.locator(`button.se-popup-button-${classHint}`).first(),
    editorPage.locator(`.se-popup-button-${classHint}`).first(),
    editorPage.getByRole('button', { name: label, exact: true }).first(),
  ];

  for (const btn of candidates) {
    if (!(await btn.isVisible({ timeout: 500 }).catch(() => false))) continue;

    await logOperation({
      level: 'info',
      message: `[post_blog] 작성중 글 팝업 — ${label} 버튼 마우스 클릭`,
    }).catch(() => {});

    try {
      await humanClickLocator(editorPage, btn, undefined, [60, 160]);
    } catch {
      const box = await btn.boundingBox().catch(() => null);
      if (!box) continue;
      await humanMouseMove(editorPage, box.x + box.width / 2, box.y + box.height / 2);
      await editorPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }

    for (let i = 0; i < 12; i += 1) {
      await sleep(200);
      if (!(await isDraftResumePopupVisible(editorPage))) {
        await logOperation({
          level: 'info',
          message: `[post_blog] 작성중 글 팝업 ${label} 완료`,
        }).catch(() => {});
        return true;
      }
    }
  }

  return !(await isDraftResumePopupVisible(editorPage));
}

/** 「작성 중인 글이 있습니다」 — 확인(이어쓰기) 금지, 취소만 마우스로 클릭해 새 글 작성 */
async function dismissDraftResumePopup(
  editorPage: Page,
  options?: { moveMouseToTitle?: boolean },
): Promise<boolean> {
  if (!(await isDraftResumePopupVisible(editorPage))) return false;

  const guard = draftDismissGuardByPage.get(editorPage);
  if (guard?.inFlight) return false;
  if (guard && Date.now() < guard.cooledUntil) {
    if (!(await isDraftResumePopupVisible(editorPage))) return true;
    draftDismissGuardByPage.delete(editorPage);
  }

  draftDismissGuardByPage.set(editorPage, { inFlight: true, cooledUntil: 0 });

  const clicked = await clickDraftResumePopupButton(editorPage, '취소');
  if (clicked) {
    if (options?.moveMouseToTitle !== false) {
      await moveMouseToTitleIfReady(editorPage);
    }
    resetDraftDismissGuard(editorPage);
    draftDismissGuardByPage.set(editorPage, {
      inFlight: false,
      cooledUntil: Date.now() + 900,
    });
    return true;
  }

  draftDismissGuardByPage.set(editorPage, { inFlight: false, cooledUntil: 0 });
  return !(await isDraftResumePopupVisible(editorPage));
}

export async function dismissDraftResumePopupConfirm(editorPage: Page): Promise<boolean> {
  if (!(await isDraftResumePopupVisible(editorPage))) return false;
  return clickDraftResumePopupButton(editorPage, '확인');
}

export async function dismissDraftResumePopupCancel(
  editorPage: Page,
  options?: { moveMouseToTitle?: boolean },
): Promise<boolean> {
  return dismissDraftResumePopup(editorPage, options);
}

/** job 제목·본문 기준 — 이어쓰기(확인) vs 새 글(취소) */
export async function resolveDraftResumePopupForJob(
  editorPage: Page,
  opts: {
    expectedTitle: string;
    expectedContent?: string;
    preferResume?: boolean;
  },
): Promise<void> {
  if (!(await isDraftResumePopupVisible(editorPage))) return;

  const resume =
    opts.preferResume ||
    (await shouldResumeDraftForJob(editorPage, opts.expectedTitle, opts.expectedContent));

  if (resume) {
    await dismissDraftResumePopupConfirm(editorPage);
    return;
  }

  await waitAndDismissDraftResumePopup(editorPage, 20_000);
}

/** 팝업이 뜨거나 사라질 때까지 빠르게 폴링하며 취소 클릭 */
export async function waitAndDismissDraftResumePopup(
  editorPage: Page,
  maxMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await dismissDraftResumePopup(editorPage)) {
      await sleep(350);
      if (!(await isDraftResumePopupVisible(editorPage))) return;
    }
    if (!(await isDraftResumePopupVisible(editorPage))) return;
    await sleep(150);
  }
  if (await isDraftResumePopupVisible(editorPage)) {
    throw new Error('DRAFT_RESUME_POPUP_STILL_VISIBLE');
  }
}

/**
 * 입력 중 재등장 — 현재 글 유지를 위해 확인(이어쓰기) 클릭. Escape는 이 팝업에 통하지 않음.
 */
export async function dismissDraftResumePopupNonDestructive(editorPage: Page): Promise<void> {
  if (!(await isDraftResumePopupVisible(editorPage))) return;
  await dismissDraftResumePopupConfirm(editorPage);
}

type EditorWaitOptions = {
  expectedTitle?: string;
  expectedContent?: string;
  preferResumeDraft?: boolean;
};

async function dismissDraftPopupIfVisible(
  editorPage: Page,
  options?: EditorWaitOptions,
): Promise<void> {
  if (!(await isDraftResumePopupVisible(editorPage))) return;

  let resume = options?.preferResumeDraft;
  if (resume === undefined && options?.expectedTitle) {
    resume = await shouldResumeDraftForJob(
      editorPage,
      options.expectedTitle,
      options.expectedContent,
    );
  }

  if (resume) {
    await dismissDraftResumePopupConfirm(editorPage);
  } else {
    await dismissDraftResumePopupCancel(editorPage, { moveMouseToTitle: true });
  }
}

/** 도움말·dim 등 — 에디터 입력을 가리는 오버레이 제거 (발행 전에도 재호출) */
export async function dismissNaverBlogEditorOverlays(
  editorPage: Page,
  options?: { includeDraftPopup?: boolean } & EditorWaitOptions,
): Promise<void> {
  await dismissSeOneHelpPanel(editorPage);

  if (options?.includeDraftPopup !== false) {
    await dismissDraftPopupIfVisible(editorPage, options);
  }

  const scopes = await editorLocatorScopes(editorPage);

  for (let round = 0; round < 4; round += 1) {
    let dismissed = false;

    await dismissSeOneHelpPanel(editorPage);

    for (const scope of scopes) {
      for (const sel of LEGACY_HELP_CLOSE_SELECTORS) {
        if (await clickIfVisible(scope, sel)) dismissed = true;
      }
      if (
        await clickIfVisible(scope, '.se-popup-dim, .se_dim, .layer_popup .btn_close, .se-popup-dim-button')
      ) {
        dismissed = true;
      }
    }

    if (await clickIfVisible(editorPage, '#cookie_close, .cookie_btn_close, button:has-text("동의")')) {
      dismissed = true;
    }

    // 임시저장 팝업이 떠 있을 때 Escape는 포커스·블록 선택만 꼬이게 함
    if (!(await isDraftResumePopupVisible(editorPage))) {
      await editorPage.keyboard.press('Escape').catch(() => {});
    }
    if (!dismissed) break;
    await sleep(350);
  }
}

/** 키보드 입력 직전 — 임시저장 팝업·도움말이 없을 때까지 대기 */
export async function prepareSeOneEditorSurface(
  editorPage: Page,
  maxMs = 25_000,
  options?: { destructiveDraftDismiss?: boolean; expectedTitle?: string; expectedContent?: string },
): Promise<void> {
  if (options?.destructiveDraftDismiss === false) {
    await dismissDraftPopupIfVisible(editorPage, {
      expectedTitle: options.expectedTitle,
      expectedContent: options.expectedContent,
      preferResumeDraft: true,
    });
  } else {
    await waitAndDismissDraftResumePopup(editorPage, maxMs);
  }
  await dismissSeOneHelpPanel(editorPage);
  await dismissNaverBlogEditorOverlays(editorPage, { includeDraftPopup: false });
  await dismissSeOneMaterialPopup(editorPage);
  if (options?.destructiveDraftDismiss !== false && (await isDraftResumePopupVisible(editorPage))) {
    throw new Error('DRAFT_RESUME_POPUP_STILL_VISIBLE');
  }
}

/** SE ONE(현행) + 구형 iframe — 제목 또는 본문 interactable */
async function isSmartEditorInteractable(editorPage: Page): Promise<boolean> {
  return isNaverBlogEditorInteractable(editorPage);
}

async function waitForSmartEditor(
  editorPage: Page,
  timeoutMs = SMART_EDITOR_WAIT_MS,
  options?: EditorWaitOptions,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await dismissDraftPopupIfVisible(editorPage, options);
    await dismissSeOneHelpPanel(editorPage);
    if (!(await isDraftResumePopupVisible(editorPage))) {
      if (await isSeOneEditorShellReady(editorPage)) return true;
      if (await isSmartEditorInteractable(editorPage)) return true;
      if (POSTWRITE_URL_RE.test(editorPage.url()) && (await findBlogTitleLocator(editorPage))) {
        return true;
      }
    }
    await sleep(EDITOR_POLL_MS);
  }

  return false;
}

async function tryEditorOnPage(
  page: Page,
  waitBudgetMs = SMART_EDITOR_WAIT_MS,
  options?: EditorWaitOptions,
): Promise<Page | null> {
  await page.bringToFront().catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  if (
    POSTWRITE_URL_RE.test(page.url()) ||
    (await page.locator('#mainFrame').count().catch(() => 0)) > 0 ||
    (await isSeOneEditorShellReady(page))
  ) {
    if (await waitForSmartEditor(page, waitBudgetMs, options)) {
      await dismissSeOneHelpPanel(page);
      await dismissNaverBlogEditorOverlays(page, { includeDraftPopup: false, ...options });
      if (await isDraftResumePopupVisible(page)) {
        await dismissDraftPopupIfVisible(page, options);
      } else {
        await dismissSeOneMaterialPopup(page);
      }
      return page;
    }
  }

  return null;
}

/**
 * 블로그 글쓰기 에디터 진입.
 * CAPTCHA 직후에는 재로그인·새 탭 금지 — 기존 postwrite 탭 로딩을 최대 180초 대기한다.
 */
export async function enterBlogEditor(
  page: Page,
  _humanEngine: HumanEngineConfig,
  options?: { accountId?: string; expectedTitle?: string; expectedContent?: string },
): Promise<Page> {
  const context = page.context();
  const waitOpts: EditorWaitOptions = {
    expectedTitle: options?.expectedTitle,
    expectedContent: options?.expectedContent,
  };

  // ① 이미 postwrite 로딩 중인 탭 — goto 없이 대기만
  const existingPostwrite = findNaverPostwritePage(context);
  if (existingPostwrite) {
    const ready = await tryEditorOnPage(existingPostwrite, SMART_EDITOR_WAIT_MS, waitOpts);
    if (ready) return ready;
  }

  if (POSTWRITE_URL_RE.test(page.url())) {
    const ready = await tryEditorOnPage(page, SMART_EDITOR_WAIT_MS, waitOpts);
    if (ready) return ready;
  }

  // ② 계정 DB에서 blogId 확보 (blog.naver.com 재이동으로 세션 꼬임 방지)
  const blogId =
    (options?.accountId ? await loadBlogIdFromAccount(options.accountId) : null) ??
    blogIdFromUrl(page.url());

  const writeUrls = blogId
    ? [`https://blog.naver.com/${blogId}/postwrite`, 'https://blog.naver.com/GoBlogWrite.naver']
    : ['https://blog.naver.com/GoBlogWrite.naver'];

  const workflowPage = findNaverPostwritePage(context) ?? page;
  const startedAt = Date.now();
  const remainingMs = () => Math.max(30_000, SMART_EDITOR_WAIT_MS - (Date.now() - startedAt));

  for (const url of writeUrls) {
    if (POSTWRITE_URL_RE.test(workflowPage.url())) break;

    let navOk = false;
    try {
      await workflowPage.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: PLAYWRIGHT_NAV_TIMEOUT_MS,
      });
      navOk = true;
    } catch {
      navOk = POSTWRITE_URL_RE.test(workflowPage.url());
    }
    if (!navOk) continue;

    await scaledSleep(1500, 3000);
    await dismissSeOneHelpPanel(workflowPage);
    // 팝업이 있으면 취소(마우스) — 못 닫아도 throw 금지, 이후 폴링이 재시도
    await waitAndDismissDraftResumePopup(workflowPage, 15_000).catch(() => {});

    const ready = await tryEditorOnPage(workflowPage, remainingMs());
    if (ready) return ready;

    const popup = context.pages().find(
      (p) => p !== workflowPage && !p.isClosed() && POSTWRITE_URL_RE.test(p.url()),
    );
    if (popup) {
      const popupReady = await tryEditorOnPage(popup, remainingMs());
      if (popupReady) return popupReady;
    }
  }

  // ③ 마지막 — 열린 모든 postwrite 탭에서 재대기 (로딩 지연·도움말 지연)
  for (const p of context.pages()) {
    if (p.isClosed() || !POSTWRITE_URL_RE.test(p.url())) continue;
    const ready = await tryEditorOnPage(p, remainingMs());
    if (ready) return ready;
  }

  const failPage = existingPostwrite ?? page;
  const titleOk = (await findBlogTitleLocator(failPage)) !== null;
  const contentOk = (await findVisibleLocator(failPage, CONTENT_EDITOR_SELECTORS)) !== null;
  const seOneShell = await isSeOneEditorShellReady(failPage);
  const detail = titleOk
    ? contentOk
      ? '제목·본문 보였으나 진입 확정 실패'
      : '제목란만 확인·본문 영역 미검출'
    : seOneShell
      ? 'SE ONE 발행 버튼 보임·제목 placeholder 미검출'
      : '#mainFrame·제목란 미표시(구형)';

  await notifySlack(
    `블로그 에디터(SmartEditor ONE) 진입 실패 — blogId=${blogId ?? '미확인'} (${SMART_EDITOR_WAIT_MS / 1000}s, ${detail})`,
  );
  throw new Error(POSTWRITE_URL_RE.test(failPage.url()) ? 'BLOG_EDITOR_NOT_READY' : 'BLOG_NAV_FAILED');
}
