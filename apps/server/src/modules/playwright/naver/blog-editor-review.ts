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
      await humanMouseMove(page, box.x + box.width * 0.55, box.y + box.height * 0.5);
      await sleep(180);
      return;
    }
  }
}

async function scrollEditorCanvas(page: Page, durationMs: number): Promise<void> {
  if (durationMs <= 0) return;
  await moveMouseToEditorCanvas(page);
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const reverse = Math.random() < 0.32;
    const delta = reverse ? -randomBetween(100, 240) : randomBetween(100, 240);
    await page.mouse.wheel(0, delta);
    await page
      .evaluate((dy) => {
        const el = document.querySelector('.se-main-container, .se-container, .se-wrap') as
          | HTMLElement
          | null;
        if (el) el.scrollTop = Math.max(0, Math.min(el.scrollHeight, el.scrollTop + dy));
      }, delta)
      .catch(() => {});
    await sleep(randomBetween(900, 2400));
  }
}

/** 발행 전 검토 — 본문으로 마우스 이동 후 스크롤 */
export async function performBlogReview(page: Page, durationMs: number, scale = 1): Promise<void> {
  await moveMouseToEditorCanvas(page);

  const scrollMs = Math.floor(durationMs * 0.75);
  const pauseMs = durationMs - scrollMs;

  await scrollEditorCanvas(page, scrollMs);
  await scaledHumanSleep(Math.max(500, pauseMs * 0.35), Math.max(900, pauseMs * 0.55), scale);
  await page.keyboard.press('Control+Home').catch(() => {});
  await sleep(250);
  await scrollEditorCanvas(page, Math.max(1000, Math.floor(pauseMs * 0.45)));
}
