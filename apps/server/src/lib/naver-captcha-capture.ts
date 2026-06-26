import type { Locator, Page } from 'playwright';

import { sleep } from './utils.js';

export type CaptureBox = { x: number; y: number; width: number; height: number };

/** 여러 요소 bounding box를 합쳐 캡처 clip 계산 */
export function unionCaptureBoxes(boxes: CaptureBox[], padding = 16): CaptureBox | null {
  const valid = boxes.filter((b) => b.width > 0 && b.height > 0);
  if (!valid.length) return null;

  const x1 = Math.min(...valid.map((b) => b.x)) - padding;
  const y1 = Math.min(...valid.map((b) => b.y)) - padding;
  const x2 = Math.max(...valid.map((b) => b.x + b.width)) + padding;
  const y2 = Math.max(...valid.map((b) => b.y + b.height)) + padding;

  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function clampCaptureBox(
  box: CaptureBox,
  viewport: { width: number; height: number },
): CaptureBox {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const right = Math.min(viewport.width, Math.ceil(box.x + box.width));
  const bottom = Math.min(viewport.height, Math.ceil(box.y + box.height));
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

async function waitForCaptchaImageReady(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const img =
          (document.querySelector('#captchaimg') as HTMLImageElement | null) ??
          (document.querySelector('#captcha img') as HTMLImageElement | null) ??
          (document.querySelector('#cptch img') as HTMLImageElement | null);
        return Boolean(img?.complete && img.naturalWidth > 20 && img.naturalHeight > 20);
      },
      { timeout: 6000 },
    )
    .catch(() => {});
  await sleep(200);
}

/** overflow:hidden으로 잘린 영수증 이미지를 natural 크기로 펼침 */
async function resetCaptchaScrollAndExpand(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const selectors = ['#captcha', '#cptch', '.captcha_wrap'];
      for (const sel of selectors) {
        const root = document.querySelector(sel) as HTMLElement | null;
        if (!root) continue;
        root.scrollLeft = 0;
        root.scrollTop = 0;
        root.style.overflow = 'visible';
        root.querySelectorAll('#captchaimg, img').forEach((node) => {
          const img = node as HTMLImageElement;
          if (!img.naturalWidth || !img.naturalHeight) return;
          img.style.maxWidth = 'none';
          img.style.width = `${img.naturalWidth}px`;
          img.style.height = `${img.naturalHeight}px`;
          img.style.objectFit = 'fill';
        });
        return;
      }
    })
    .catch(() => {});
}

/** 캡차 영역 내 모든 영수증 img — natural 크기 (1~N장) */
export async function captureAllCaptchaReceiptImagesPng(page: Page): Promise<Buffer[]> {
  await waitForCaptchaImageReady(page);

  const base64List = await page
    .evaluate(() => {
      const root =
        (document.querySelector('#captcha') as HTMLElement | null) ??
        (document.querySelector('#cptch') as HTMLElement | null) ??
        (document.querySelector('.captcha_wrap') as HTMLElement | null);

      const nodes = root
        ? [...root.querySelectorAll('#captchaimg, img')]
        : [
            ...(document.querySelectorAll('#captchaimg') as NodeListOf<HTMLImageElement>),
            ...(document.querySelectorAll('#captcha img') as NodeListOf<HTMLImageElement>),
          ];

      const seen = new Set<string>();
      const out: Array<{ b64: string; top: number; left: number }> = [];

      for (const node of nodes) {
        const img = node as HTMLImageElement;
        if (!img.naturalWidth || !img.naturalHeight) continue;
        const rect = img.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;

        const key = `${img.src}|${img.naturalWidth}x${img.naturalHeight}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w < 24 || h < 24) continue;

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        try {
          ctx.drawImage(img, 0, 0, w, h);
          const data = canvas.toDataURL('image/png');
          out.push({
            b64: data.slice(data.indexOf(',') + 1),
            top: rect.top,
            left: rect.left,
          });
        } catch {
          /* CORS 등 — skip */
        }
      }

      return out
        .sort((a, b) => a.top - b.top || a.left - b.left)
        .map((item) => item.b64);
    })
    .catch(() => [] as string[]);

  return base64List
    .map((b64) => Buffer.from(b64, 'base64'))
    .filter((buf) => buf.length > 400);
}

/** #captchaimg 원본 픽셀 전체 — 세로·가로 잘림 방지 (첫 번째=화면 최상단 영수증 이미지) */
export async function captureFullCaptchaImagePng(page: Page): Promise<Buffer | null> {
  const all = await captureAllCaptchaReceiptImagesPng(page);
  return all[0] ?? null;
}

async function collectCaptchaVisibleBoxes(page: Page, root: Locator): Promise<CaptureBox[]> {
  const boxes: CaptureBox[] = [];
  const rootBox = await root.boundingBox().catch(() => null);
  if (rootBox) boxes.push(rootBox);

  const selectors = [
    '#captchaimg',
    'img',
    '.captcha_message',
    'p',
    'label',
    'input',
    'textarea',
    '.btn_confirm',
    '#captcha_confirm',
    '[class*="refresh"]',
  ];

  for (const sel of selectors) {
    const loc = root.locator(sel);
    const count = Math.min(await loc.count().catch(() => 0), 8);
    for (let i = 0; i < count; i += 1) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const box = await el.boundingBox().catch(() => null);
      if (box && box.width > 4 && box.height > 4) boxes.push(box);
    }
  }

  return boxes;
}

/**
 * 캡차 루트·이미지·질문·입력칸 union clip — VNC/텔레그램 hold용.
 * 스크롤 리셋 + overflow 펼친 뒤 뷰포트 clip 캡처.
 */
export async function captureCaptchaRegionPng(page: Page, root: Locator): Promise<Buffer | null> {
  await page.bringToFront().catch(() => {});
  await root.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await waitForCaptchaImageReady(page);
  await resetCaptchaScrollAndExpand(page);
  await sleep(300);

  const viewport = page.viewportSize();
  if (!viewport) {
    return root.screenshot({ type: 'png', animations: 'disabled' }).catch(() => null);
  }

  const boxes = await collectCaptchaVisibleBoxes(page, root);
  const union = unionCaptureBoxes(boxes, 16);
  if (!union) {
    return root.screenshot({ type: 'png', animations: 'disabled' }).catch(() => null);
  }

  const clip = clampCaptureBox(union, viewport);
  const buf = await page
    .screenshot({
      type: 'png',
      animations: 'disabled',
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
    })
    .catch(() => null);

  if (buf && buf.length > 800) return buf;
  return root.screenshot({ type: 'png', animations: 'disabled' }).catch(() => buf);
}
