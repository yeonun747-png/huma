import type { Page } from 'playwright';

import { humanMouseMove, humanClickAtPoint } from '../../human-engine/mouse.js';
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
      await humanMouseMove(page, box.x + box.width * 0.5, box.y + box.height * 0.52);
      await sleep(180);
      return;
    }
  }
}

/** 사진 툴바 직후 — 본문 섹션 중앙 클릭·포커스 (제목·툴바 이탈) */
export async function moveMouseToBodyCenterForReview(page: Page): Promise<void> {
  const candidates = [
    '.se-section-text',
    '.se-components-wrap',
    '.se-main-container',
    '.se-container',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    const box = await loc.boundingBox().catch(() => null);
    if (box && box.width > 160 && box.height > 120) {
      const x = box.x + box.width * 0.5;
      const y = box.y + Math.min(box.height * 0.55, box.height - 80);
      await humanClickAtPoint(page, x, y, undefined, [90, 220]);
      await sleep(200);
      return;
    }
  }
  await moveMouseToEditorCanvas(page);
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

/** 이미지·링크 삽입 직후 — 툴바에서 본문으로 포인터 이동 후 읽듯 스크롤 */
export async function performPostMediaBodyReview(page: Page, scale = 1): Promise<void> {
  await moveMouseToBodyCenterForReview(page);
  const rounds = randomBetween(3, 5);
  for (let i = 0; i < rounds; i += 1) {
    const reverse = i > 0 && Math.random() < 0.45;
    const delta = reverse ? -randomBetween(120, 280) : randomBetween(140, 320);
    await page.mouse.wheel(0, delta);
    await page
      .evaluate((dy) => {
        const el = document.querySelector('.se-main-container, .se-container, .se-wrap') as
          | HTMLElement
          | null;
        if (el) el.scrollTop = Math.max(0, Math.min(el.scrollHeight, el.scrollTop + dy));
      }, delta)
      .catch(() => {});
    await scaledHumanSleep(700, 1800, scale);
  }
  await scaledHumanSleep(400, 900, scale);
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
