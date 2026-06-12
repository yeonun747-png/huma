import type { BrowserContext, Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';

import type { HumanEngineConfig } from '../../../lib/settings.js';

import { notifySlack } from '../../watcher/detector.js';

import { vncFastSleepScale } from '../../../lib/vnc-session.js';
import { PLAYWRIGHT_NAV_TIMEOUT_MS } from '../../../lib/playwright-nav-timeout.js';
import { sleep } from '../../../lib/utils.js';
import { supabase } from '../../../middleware/auth.js';

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

/** VNC/Xvfb — SmartEditor ONE 초기 로딩이 느릴 수 있음 */
const SMART_EDITOR_WAIT_MS = 120_000;

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
function findPostwritePage(context: BrowserContext): Page | undefined {
  return context.pages().find((p) => !p.isClosed() && POSTWRITE_URL_RE.test(p.url()));
}

async function dismissEditorOverlays(editorPage: Page): Promise<void> {
  const frame = editorPage.frameLocator('#mainFrame');

  const cancelDraft = frame
    .locator(
      '.se-popup-button-cancel, .se_popup_btn_cancel, button:has-text("취소"), button:has-text("새로 작성")',
    )
    .first();
  if (await cancelDraft.isVisible({ timeout: 4000 }).catch(() => false)) {
    await cancelDraft.click({ timeout: 5000 }).catch(() => {});
    await sleep(600);
  }

  const closeHelp = frame
    .locator(
      '.se-help-panel-close-button, button.se-help-panel-close-button, .btn_close_help, .se-help-panel button[aria-label="닫기"]',
    )
    .first();
  if (await closeHelp.isVisible({ timeout: 1500 }).catch(() => false)) {
    await closeHelp.click({ timeout: 4000 }).catch(() => {});
    await sleep(300);
  }

  const dimDismiss = frame
    .locator('.se-popup-dim, .se_dim, .layer_popup .btn_close, button:has-text("닫기")')
    .first();
  if (await dimDismiss.isVisible({ timeout: 1200 }).catch(() => false)) {
    await dimDismiss.click({ timeout: 4000 }).catch(() => {});
    await sleep(250);
  }

  const cookieClose = editorPage
    .locator('#cookie_close, .cookie_btn_close, button:has-text("동의")')
    .first();
  if (await cookieClose.isVisible({ timeout: 1000 }).catch(() => false)) {
    await cookieClose.click({ timeout: 3000 }).catch(() => {});
    await sleep(200);
  }
}

async function waitForSmartEditor(editorPage: Page, timeoutMs = SMART_EDITOR_WAIT_MS): Promise<boolean> {
  try {
    await editorPage.waitForSelector('#mainFrame', { state: 'attached', timeout: timeoutMs });
    await editorPage
      .frameLocator('#mainFrame')
      .locator('.se-content')
      .waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function tryEditorOnPage(page: Page): Promise<Page | null> {
  await page.bringToFront().catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await dismissEditorOverlays(page);
  if (await waitForSmartEditor(page)) {
    await dismissEditorOverlays(page);
    return page;
  }
  return null;
}

/**
 * 블로그 글쓰기 에디터 진입.
 * CAPTCHA 직후에는 재로그인·새 탭 금지 — 기존 postwrite 탭 로딩을 최대 90초 대기한다.
 */
export async function enterBlogEditor(
  page: Page,
  _humanEngine: HumanEngineConfig,
  options?: { accountId?: string },
): Promise<Page> {
  const context = page.context();

  // ① 이미 postwrite 로딩 중인 탭 — goto 없이 대기만
  const existingPostwrite = findPostwritePage(context);
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

  const workflowPage = findPostwritePage(context) ?? page;

  for (const url of writeUrls) {
    if (POSTWRITE_URL_RE.test(workflowPage.url())) break;

    await workflowPage
      .goto(url, { waitUntil: 'domcontentloaded', timeout: PLAYWRIGHT_NAV_TIMEOUT_MS })
      .catch(() => {});
    await scaledSleep(1500, 3000);

    const ready = await tryEditorOnPage(workflowPage);
    if (ready) return ready;

    // 일부 경로는 팝업 탭 — 기존 탭만 사용, 새 로그인 탭 생성 금지
    const popup = context.pages().find(
      (p) => p !== workflowPage && !p.isClosed() && POSTWRITE_URL_RE.test(p.url()),
    );
    if (popup) {
      const popupReady = await tryEditorOnPage(popup);
      if (popupReady) return popupReady;
    }
  }

  // ③ 마지막 — 열린 모든 postwrite 탭에서 재대기 (로딩 지연)
  for (const p of context.pages()) {
    if (p.isClosed() || !POSTWRITE_URL_RE.test(p.url())) continue;
    const ready = await tryEditorOnPage(p);
    if (ready) return ready;
  }

  await notifySlack(
    `블로그 에디터(SmartEditor ONE) 진입 실패 — blogId=${blogId ?? '미확인'} (${SMART_EDITOR_WAIT_MS / 1000}s 대기 후에도 #mainFrame/.se-content 미표시)`,
  );
  throw new Error('BLOG_EDITOR_NOT_READY');
}
