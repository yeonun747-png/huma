import type { Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';

import type { HumanEngineConfig } from '../../../lib/settings.js';

import { notifySlack } from '../../watcher/detector.js';

import { vncFastSleepScale } from '../../../lib/vnc-session.js';
import { PLAYWRIGHT_NAV_TIMEOUT_MS } from '../../../lib/playwright-nav-timeout.js';
import { sleep } from '../../../lib/utils.js';

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

function blogIdFromUrl(url: string): string | null {
  if (url.includes('section.blog') || /BlogHome/i.test(url)) return null;
  const id = url.match(BLOG_ID_RE)?.[1];
  if (!id || RESERVED_BLOG_PATHS.has(id) || /\.naver$/i.test(id)) return null;
  return id;
}

/** 로그인된 계정의 블로그ID 확보 — 현재 URL → 포털 리다이렉트 → 「내 블로그」 링크 순 */
async function resolveBlogId(page: Page): Promise<string | null> {
  const direct = blogIdFromUrl(page.url());
  if (direct) return direct;

  await page
    .goto('https://blog.naver.com', { waitUntil: 'domcontentloaded', timeout: PLAYWRIGHT_NAV_TIMEOUT_MS })
    .catch(() => {});
  await sleep(1500);

  const afterRedirect = blogIdFromUrl(page.url());
  if (afterRedirect) return afterRedirect;

  const myBlog = page
    .locator('a[href*="blog.naver.com/"]:not([href*="section.blog"]):not([href*="BlogHome"])')
    .first();
  const href = await myBlog.getAttribute('href').catch(() => null);
  if (href) {
    const id = href.match(BLOG_ID_RE)?.[1];
    if (id && !RESERVED_BLOG_PATHS.has(id)) return id;
  }
  return null;
}

/**
 * SmartEditor ONE 진입 직후 뜨는 레이어 정리:
 * - "작성 중이던 글이 있습니다" 복구 팝업 → 취소(새 글로 시작)
 * - 도움말/가이드 오버레이 → 닫기
 * 팝업은 #mainFrame 안에 렌더된다.
 */
async function dismissEditorOverlays(editorPage: Page): Promise<void> {
  const frame = editorPage.frameLocator('#mainFrame');

  const cancelDraft = frame
    .locator('.se-popup-button-cancel, .se_popup_btn_cancel, button:has-text("취소")')
    .first();
  if (await cancelDraft.isVisible({ timeout: 4000 }).catch(() => false)) {
    await cancelDraft.click({ timeout: 5000 }).catch(() => {});
    await sleep(600);
  }

  const closeHelp = frame
    .locator('.se-help-panel-close-button, button.se-help-panel-close-button, .btn_close_help')
    .first();
  if (await closeHelp.isVisible({ timeout: 1500 }).catch(() => false)) {
    await closeHelp.click({ timeout: 4000 }).catch(() => {});
    await sleep(300);
  }
}

async function waitForSmartEditor(editorPage: Page): Promise<boolean> {
  try {
    await editorPage.waitForSelector('#mainFrame', { state: 'attached', timeout: 30_000 });
    await editorPage
      .frameLocator('#mainFrame')
      .locator('.se-content')
      .waitFor({ state: 'visible', timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 블로그 글쓰기 에디터 진입 — 공식 직접 URL 사용.
 * 네이버 개인 블로그의 「글쓰기」 버튼 클릭은 목록/뷰어로 빠지는 경우가 많아,
 * 로그인 상태에서 SmartEditor ONE을 바로 여는 blog.naver.com/{id}/postwrite 로 이동한다.
 * (실패 시 GoBlogWrite.naver 폴백.) 반환값: 에디터가 떠 있는 Page.
 */
export async function enterBlogEditor(page: Page, _humanEngine: HumanEngineConfig): Promise<Page> {
  const blogId = await resolveBlogId(page);

  const writeUrls = blogId
    ? [`https://blog.naver.com/${blogId}/postwrite`, 'https://blog.naver.com/GoBlogWrite.naver']
    : ['https://blog.naver.com/GoBlogWrite.naver'];

  for (const url of writeUrls) {
    await page
      .goto(url, { waitUntil: 'domcontentloaded', timeout: PLAYWRIGHT_NAV_TIMEOUT_MS })
      .catch(() => {});
    await scaledSleep(1200, 2500);

    // 글쓰기는 동일 탭에서 열리지만, 일부 경로는 새 탭(팝업)을 띄운다.
    const popup = page
      .context()
      .pages()
      .find((p) => p !== page && /postwrite|PostWriteForm|GoBlogWrite/i.test(p.url()));
    const editorPage = popup ?? page;

    await editorPage.waitForLoadState('domcontentloaded').catch(() => {});
    await dismissEditorOverlays(editorPage);

    if (await waitForSmartEditor(editorPage)) {
      await dismissEditorOverlays(editorPage);
      return editorPage;
    }
  }

  await notifySlack(
    `블로그 에디터(SmartEditor ONE) 진입 실패 — blogId=${blogId ?? '미확인'} (postwrite/GoBlogWrite 모두 #mainFrame/.se-content 미표시)`,
  );
  throw new Error('BLOG_EDITOR_NOT_READY');
}
