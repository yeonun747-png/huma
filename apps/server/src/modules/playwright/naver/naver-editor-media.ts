import type { Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';
import { clickEditorToolbar, findVisibleLocator } from './naver-editor-locators.js';

async function insertFileViaToolbar(
  page: Page,
  localPath: string,
  toolbar: { dataNames: string[]; buttonTexts: string[]; classHints: string[] },
): Promise<boolean> {
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 }).catch(() => null);
  const clicked = await clickEditorToolbar(page, toolbar);
  if (!clicked) return false;

  const chooser = await chooserPromise;
  if (!chooser) return false;

  await chooser.setFiles(localPath);
  await humanSleep(2000, 4500);
  return true;
}

/** 툴바 「사진」 → filechooser. 실패 시 hidden input 폴백 */
export async function insertImageViaToolbar(page: Page, localPath: string): Promise<void> {
  const viaToolbar = await insertFileViaToolbar(page, localPath, {
    dataNames: ['image', 'photo'],
    buttonTexts: ['사진'],
    classHints: ['image-toolbar', 'photo'],
  });

  if (viaToolbar) return;

  const fileInput = await findVisibleLocator(
    page,
    ['input[type="file"]', '#mainFrame input[type="file"]'],
    { inFrame: false },
  );
  if (fileInput) {
    await fileInput.setInputFiles(localPath);
    await humanSleep(2000, 4000);
    return;
  }

  const fallback = page.locator('input[type="file"]').first();
  if ((await fallback.count()) > 0) {
    await fallback.setInputFiles(localPath);
    await humanSleep(2000, 4000);
  }
}

/** 툴바 「동영상」 — video_path 있을 때만 호출 */
export async function insertVideoViaToolbar(page: Page, localPath: string): Promise<boolean> {
  return insertFileViaToolbar(page, localPath, {
    dataNames: ['video', 'movie'],
    buttonTexts: ['동영상', '영상'],
    classHints: ['video-toolbar', 'movie'],
  });
}
