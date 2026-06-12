import type { BrowserContext, Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';

import type { HumanEngineConfig } from '../../../lib/settings.js';

import { notifySlack } from '../../watcher/detector.js';

import { vncFastSleepScale } from '../../../lib/vnc-session.js';
import { PLAYWRIGHT_NAV_TIMEOUT_MS } from '../../../lib/playwright-nav-timeout.js';
import { sleep } from '../../../lib/utils.js';
import { supabase } from '../../../middleware/auth.js';
import {
  BLOG_BODY_SELECTORS,
  BLOG_TITLE_SELECTORS,
  findBlogTitleLocator,
  findVisibleLocator,
  isNaverBlogEditorInteractable,
  isSeOneEditorShellReady,
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

const HELP_CLOSE_SELECTORS = [
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

/** 「작성 중인 글이 있습니다」 — 확인(이어쓰기) 금지, 취소만 클릭해 새 글 작성 */
async function dismissDraftResumePopup(editorPage: Page): Promise<boolean> {
  const scopes: Array<Page | ReturnType<Page['frameLocator']>> = [
    editorPage,
    editorPage.frameLocator('#mainFrame'),
  ];

  for (const scope of scopes) {
    const popup = scope.locator('text=작성 중인 글이 있습니다').first();
    if (!(await popup.isVisible({ timeout: 500 }).catch(() => false))) continue;

    const cancelBtn = scope.locator('button:has-text("취소")').first();
    if (await cancelBtn.isVisible({ timeout: 800 }).catch(() => false)) {
      await cancelBtn.click({ timeout: 4000 }).catch(() => {});
      await sleep(450);
      return true;
    }
  }
  return false;
}

/** 도움말·임시저장·dim 등 — 에디터 입력을 가리는 오버레이 제거 (발행 전에도 재호출) */
export async function dismissNaverBlogEditorOverlays(editorPage: Page): Promise<void> {
  await dismissDraftResumePopup(editorPage);

  const frame = editorPage.frameLocator('#mainFrame');
  const scopes: Array<Page | ReturnType<Page['frameLocator']>> = [frame, editorPage];

  for (let round = 0; round < 4; round += 1) {
    let dismissed = false;

    if (await dismissDraftResumePopup(editorPage)) dismissed = true;

    for (const scope of scopes) {
      if (
        await clickIfVisible(
          scope,
          '.se-popup-button-cancel, .se_popup_btn_cancel, button:has-text("취소")',
        )
      ) {
        dismissed = true;
      }
      for (const sel of HELP_CLOSE_SELECTORS) {
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

    await editorPage.keyboard.press('Escape').catch(() => {});
    if (!dismissed) break;
    await sleep(350);
  }
}

/** SE ONE(현행) + 구형 iframe — 제목 또는 본문 interactable */
async function isSmartEditorInteractable(editorPage: Page): Promise<boolean> {
  return isNaverBlogEditorInteractable(editorPage);
}

async function waitForSmartEditor(editorPage: Page, timeoutMs = SMART_EDITOR_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await dismissNaverBlogEditorOverlays(editorPage);
    if (await isSmartEditorInteractable(editorPage)) return true;
    await sleep(EDITOR_POLL_MS);
  }

  return false;
}

async function tryEditorOnPage(page: Page, waitBudgetMs = SMART_EDITOR_WAIT_MS): Promise<Page | null> {
  await page.bringToFront().catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  if (POSTWRITE_URL_RE.test(page.url()) || (await page.locator('#mainFrame').count().catch(() => 0)) > 0) {
    if (await waitForSmartEditor(page, waitBudgetMs)) {
      await dismissNaverBlogEditorOverlays(page);
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
  options?: { accountId?: string },
): Promise<Page> {
  const context = page.context();

  // ① 이미 postwrite 로딩 중인 탭 — goto 없이 대기만
  const existingPostwrite = findNaverPostwritePage(context);
  if (existingPostwrite) {
    const ready = await tryEditorOnPage(existingPostwrite);
    if (ready) return ready;
  }

  if (POSTWRITE_URL_RE.test(page.url())) {
    const ready = await tryEditorOnPage(page);
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

    await workflowPage
      .goto(url, { waitUntil: 'domcontentloaded', timeout: PLAYWRIGHT_NAV_TIMEOUT_MS })
      .catch(() => {});
    await scaledSleep(1500, 3000);
    await dismissDraftResumePopup(workflowPage);

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
  throw new Error('BLOG_EDITOR_NOT_READY');
}
