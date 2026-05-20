import type { Page } from 'playwright';
import { randomBetween, sleep } from '../../lib/utils.js';

export async function scrollReview(page: Page, durationMs: number) {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    await page.mouse.wheel(0, randomBetween(80, 200));
    await sleep(randomBetween(800, 2500));
  }
}

export async function scrollRead(page: Page, durationMs: number) {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    await page.mouse.wheel(0, randomBetween(100, 350));
    await sleep(randomBetween(1500, 4000));
    if (Math.random() < 0.15) {
      await page.mouse.wheel(0, -randomBetween(50, 150));
      await sleep(randomBetween(500, 1500));
    }
  }
}
