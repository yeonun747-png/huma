import type { BrowserContext, Page } from 'playwright';

import { findNaverPostwritePage } from './enter-blog-editor.js';
import { pickPostingWorkflowPage } from '../../../lib/posting-captcha-session.js';
import { sleep } from '../../../lib/utils.js';

/** post_blog worker·CAPTCHA 재개 공통 재시도 정책 */
export const POST_BLOG_RETRY = {
  maxAttempts: 5,
  delayMs: 12_000,
} as const;

export const POST_BLOG_RETRYABLE_ERRORS = [
  'BLOG_EDITOR_NOT_READY',
  'BLOG_NAV_FAILED',
  'BLOG_TITLE_NOT_FOUND',
  'BLOG_TITLE_WRITE_FAILED',
  'BLOG_BODY_NOT_FOUND',
  'BLOG_BODY_INSERTED_INTO_TITLE',
  'BLOG_TITLE_LOST_BEFORE_REVIEW',
  'NAVER_PUBLISH_BTN_NOT_FOUND',
  'NAVER_CONFIRM_PUBLISH_NOT_FOUND',
  'NAVER_PUBLISH_NOT_CONFIRMED',
  'BLOG_IMAGE_INSERT_FAILED',
  'BLOG_VIDEO_INSERT_FAILED',
] as const;

export function isPostBlogRetryableError(message: string): boolean {
  return POST_BLOG_RETRYABLE_ERRORS.some((code) => message.includes(code));
}

const PUBLISHED_URL_RE = /PostView|logNo=|Redirect=Log|\/\d{8,}/i;

/** 발행 완료 URL 추출 */
export function extractPublishedPostUrl(url: string): string | null {
  if (!url.includes('blog.naver.com')) return null;
  if (PUBLISHED_URL_RE.test(url)) return url;
  return null;
}

export function isPostBlogPublishedUrl(url: string): boolean {
  return extractPublishedPostUrl(url) !== null;
}

/** postwrite 탭 최우선 — 검색·dict 탭 오선택 방지 */
export function resolvePostBlogWorkflowPage(context: BrowserContext): Page | undefined {
  return findNaverPostwritePage(context) ?? pickPostingWorkflowPage(context);
}

/** 발행 확인 — PostView·logNo·포스트 URL 대기 */
export async function waitForNaverPublishSuccess(page: Page, timeoutMs = 45_000): Promise<string> {
  const existing = extractPublishedPostUrl(page.url());
  if (existing) return existing;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    const hit = extractPublishedPostUrl(url);
    if (hit) return hit;

    const successText = await page
      .locator('body')
      .innerText({ timeout: 800 })
      .catch(() => '');
    if (/발행되었습니다|등록되었습니다|게시되었습니다/.test(successText)) {
      await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      const after = extractPublishedPostUrl(page.url());
      if (after) return after;
    }

    try {
      await page.waitForURL(
        (u) => isPostBlogPublishedUrl(u.href),
        { timeout: Math.min(4000, Math.max(500, deadline - Date.now())) },
      );
      const finalUrl = extractPublishedPostUrl(page.url());
      if (finalUrl) return finalUrl;
    } catch {
      /* poll */
    }
    await sleep(500);
  }

  throw new Error('NAVER_PUBLISH_NOT_CONFIRMED');
}
