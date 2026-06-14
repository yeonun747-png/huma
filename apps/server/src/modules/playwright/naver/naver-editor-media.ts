import { readFileSync } from 'fs';
import { extname } from 'path';
import type { Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';
import {
  clickEditorToolbar,
  findVisibleLocator,
  isBlogImageInBodySection,
} from './naver-editor-locators.js';

async function insertFileViaToolbar(
  page: Page,
  localPath: string,
  toolbar: { dataNames: string[]; buttonTexts: string[]; classHints: string[] },
): Promise<boolean> {
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 12_000 }).catch(() => null);
  const clicked = await clickEditorToolbar(page, toolbar);
  if (!clicked) return false;

  const chooser = await chooserPromise;
  if (!chooser) return false;

  await chooser.setFiles(localPath);
  await humanSleep(2000, 4500);
  return true;
}

function mimeForImagePath(localPath: string): string {
  const ext = extname(localPath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

/** 캐럿 위치에 클립보드 붙여넣기 — 실패 시 툴바 filechooser */
export async function pasteBlogImageAtCaret(page: Page, localPath: string): Promise<boolean> {
  const mime = mimeForImagePath(localPath);
  const bytes = readFileSync(localPath);

  const clipboardReady = await page
    .evaluate(
      async ({ data, mimeType }) => {
        try {
          const blob = new Blob([new Uint8Array(data)], { type: mimeType });
          await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })]);
          return true;
        } catch {
          return false;
        }
      },
      { data: Array.from(bytes), mimeType: mime },
    )
    .catch(() => false);

  if (clipboardReady) {
    await page.keyboard.press('Control+v');
    await humanSleep(2500, 4500);
    if (await isBlogImageInBodySection(page)) return true;
  }

  return insertImageViaToolbar(page, localPath);
}

/** @deprecated 툴바 se-image 오탐 — isBlogImageInBodySection 사용 */
export async function isBlogImageInEditor(page: Page): Promise<boolean> {
  return isBlogImageInBodySection(page);
}

/** 툴바 「사진」 → filechooser. 실패 시 hidden input 폴백 */
export async function insertImageViaToolbar(page: Page, localPath: string): Promise<boolean> {
  const viaToolbar = await insertFileViaToolbar(page, localPath, {
    dataNames: ['image', 'photo'],
    buttonTexts: ['사진'],
    classHints: ['image-toolbar', 'photo'],
  });
  if (viaToolbar) return true;

  const fileInput = await findVisibleLocator(
    page,
    ['input[type="file"]', '#mainFrame input[type="file"]'],
    { inFrame: false },
  );
  if (fileInput) {
    await fileInput.setInputFiles(localPath);
    await humanSleep(2000, 4000);
    return true;
  }

  const fallback = page.locator('input[type="file"]').first();
  if ((await fallback.count()) > 0) {
    await fallback.setInputFiles(localPath);
    await humanSleep(2000, 4000);
    return true;
  }

  return false;
}

/** 툴바 「동영상」 — video_path 있을 때만 호출 */
export async function insertVideoViaToolbar(page: Page, localPath: string): Promise<boolean> {
  return insertFileViaToolbar(page, localPath, {
    dataNames: ['video', 'movie'],
    buttonTexts: ['동영상', '영상'],
    classHints: ['video-toolbar', 'movie'],
  });
}