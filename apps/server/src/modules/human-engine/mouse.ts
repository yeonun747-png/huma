import type { Page } from 'playwright';
import { randomBetween, sleep } from '../../lib/utils.js';

export async function humanMouseMove(page: Page, x: number, y: number) {
  const steps = randomBetween(8, 20);
  const start = { x: randomBetween(100, 400), y: randomBetween(100, 400) };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = start.x + (x - start.x) * t + randomBetween(-3, 3);
    const cy = start.y + (y - start.y) * t + randomBetween(-3, 3);
    await page.mouse.move(cx, cy);
    await sleep(randomBetween(10, 30));
  }
}

export async function humanClick(page: Page, selector: string) {
  const el = page.locator(selector);
  const box = await el.boundingBox();
  if (box) {
    await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
  }
  await sleep(randomBetween(100, 400));
  await el.click();
}
