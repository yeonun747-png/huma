import type { Page } from 'playwright';

import { scrollReview, scaledHumanSleep } from '../../human-engine/timing.js';
import { focusBlogBodyEnd, blogBodySectionLocator } from './naver-editor-locators.js';
import { sleep } from '../../../lib/utils.js';

/** 발행 전 검토 — 스크롤·읽기 pause (오탈자 수정은 추후 sim 연동) */
export async function performBlogReview(page: Page, durationMs: number, scale = 1): Promise<void> {
  const scrollMs = Math.floor(durationMs * 0.7);
  const readMs = durationMs - scrollMs;

  await scrollReview(page, scrollMs);

  const editor = blogBodySectionLocator(page);
  await focusBlogBodyEnd(page, editor).catch(() => {});
  await page.keyboard.press('Control+Home').catch(() => {});
  await sleep(400);
  await scaledHumanSleep(Math.max(800, readMs * 0.35), Math.max(1200, readMs * 0.5), scale);
  await scrollReview(page, Math.max(1500, readMs * 0.5));
}
