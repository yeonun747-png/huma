import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Page } from 'playwright';

import { captureNaverCaptchaPng } from './naver-captcha-vision.js';

const SCREENSHOT_DIR = path.join(os.tmpdir(), 'huma-captcha-holds');

export function captchaHoldScreenshotFile(jobId: string): string {
  return path.join(SCREENSHOT_DIR, `${jobId}.png`);
}

export async function saveCaptchaHoldScreenshot(page: Page, jobId: string): Promise<string | null> {
  const buf = await captureNaverCaptchaPng(page);
  if (!buf?.length) return null;

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const filePath = captchaHoldScreenshotFile(jobId);
  await fs.writeFile(filePath, buf);
  return filePath;
}

export async function readCaptchaHoldScreenshot(jobId: string): Promise<Buffer | null> {
  const filePath = captchaHoldScreenshotFile(jobId);
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

export async function deleteCaptchaHoldScreenshot(jobId: string): Promise<void> {
  await fs.unlink(captchaHoldScreenshotFile(jobId)).catch(() => {});
}
