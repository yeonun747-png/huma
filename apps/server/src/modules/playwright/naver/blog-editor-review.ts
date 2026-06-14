import type { Page } from 'playwright';

import { humanMouseMove } from '../../human-engine/mouse.js';
import { scaledHumanSleep } from '../../human-engine/timing.js';
import { randomBetween, sleep } from '../../../lib/utils.js';

const EDITOR_SCROLL_SELECTORS = [
  '.se-main-container',
  '.se-container',
  '.se-components-wrap',
];

async function moveMouseToEditorCanvas(page: Page): Promise<void> {
  for (const sel of EDITOR_SCROLL_SELECTORS) {
    const loc = page.locator(sel).first();
    const box = await loc.boundingBox().catch(() => null);
    if (box && box.width > 120 && box.height > 120) {
      await humanMouseMove(page, box.x + box.width * 0.52, box.y + box.height * 0.42);
      await sleep(180);
      return;
    }
  }
}

/** 에디터 본문 영역 스크롤 — 툴바(사진 아이콘) 위 wheel 오동작 방지 */
async function scrollEditorCanvas(page: Page, durationMs: number): Promise<void> {
  await moveMouseToEditorCanvas(page);
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const reverse = Math.random() < 0.28;
    const delta = reverse ? -randomBetween(90, 220) : randomBetween(90, 220);
    await page.mouse.wheel(0, delta);
    await page
      .evaluate((dy) => {
        const el = document.querySelector('.se-main-container, .se-container, .se-wrap') as
          | HTMLElement
          | null;
        if (el) el.scrollTop = Math.max(0, Math.min(el.scrollHeight, el.scrollTop + dy));
      }, delta)
      .catch(() => {});
    await sleep(randomBetween(700, 2200));
  }
}

/** 발행 전 검토 — 본문 영역 스크롤·읽기 pause */
export async function performBlogReview(page: Page, durationMs: number, scale = 1): Promise<void> {
  const scrollMs = Math.floor(durationMs * 0.82);
  const pauseMs = durationMs - scrollMs;

  await scrollEditorCanvas(page, scrollMs);
  await moveMouseToEditorCanvas(page);
  await scaledHumanSleep(Math.max(600, pauseMs * 0.4), Math.max(1000, pauseMs * 0.7), scale);
  await page.keyboard.press('Control+Home').catch(() => {});
  await sleep(300);
  await scrollEditorCanvas(page, Math.max(1200, Math.floor(pauseMs * 0.5)));
}
