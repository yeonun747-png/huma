import { readFileSync } from 'fs';
import { extname } from 'path';
import type { FileChooser, Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { sleep } from '../../../lib/utils.js';
import {
  blurBlogTitleField,
  clickEditorToolbar,
  dismissSeOneMaterialPopup,
  findVisibleLocator,
  isBlogImagePresentInBody,
  isBlogImageInBodySection,
} from './naver-editor-locators.js';
import { moveMouseToTopPublishButton } from './naver-publish-dialog.js';
import { logOperation } from '../../../lib/log-emitter.js';

async function preparePointerForPublishAfterImage(page: Page): Promise<void> {
  await blurBlogTitleField(page);
  await dismissSeOneMaterialPopup(page);
  await moveMouseToTopPublishButton(page);
}

async function waitForBlogImageLoaded(page: Page, timeoutMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isBlogImagePresentInBody(page)) return true;
    await sleep(400);
  }
  return isBlogImagePresentInBody(page);
}

async function openPhotoFileChooser(page: Page): Promise<FileChooser | null> {
  const scopedSelectors = [
    '.se-toolbar button[data-name="image"]',
    '.se-toolbar-item-image button',
    '.se-toolbar-item-image',
    '[class*="se-toolbar"] button[data-name="image"]',
    'button.se-toolbar-button-image',
  ];

  for (const sel of scopedSelectors) {
    const loc = await findVisibleLocator(page, [sel]);
    if (!loc) continue;

    const chooserPromise = page.waitForEvent('filechooser', { timeout: 12_000 }).catch(() => null);
    try {
      await humanClickLocator(page, loc);
    } catch {
      await loc.click({ timeout: 5000 }).catch(() => {});
    }
    const chooser = await chooserPromise;
    if (chooser) return chooser;
    await sleep(300);
  }

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 12_000 }).catch(() => null);
  const clicked = await clickEditorToolbar(page, {
    dataNames: ['image', 'photo'],
    buttonTexts: ['사진'],
    classHints: ['image-toolbar', 'photo'],
  });
  if (!clicked) return null;
  return chooserPromise;
}

async function insertFileViaToolbar(
  page: Page,
  localPath: string,
  toolbar: { dataNames: string[]; buttonTexts: string[]; classHints: string[] },
  options?: { keepCaret?: boolean },
): Promise<boolean> {
  const chooser = await openPhotoFileChooser(page);
  if (!chooser) {
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 12_000 }).catch(() => null);
    const clicked = await clickEditorToolbar(page, toolbar);
    if (!clicked) return false;
    const fallbackChooser = await chooserPromise;
    if (!fallbackChooser) return false;
    await fallbackChooser.setFiles(localPath);
    if (!options?.keepCaret) {
      await preparePointerForPublishAfterImage(page);
    } else {
      await dismissSeOneMaterialPopup(page);
    }
    await humanSleep(800, 1600);
    const loaded = await waitForBlogImageLoaded(page);
    if (loaded) return true;
    if (await isBlogImagePresentInBody(page)) return true;
    await logOperation({
      level: 'warn',
      message: '[post_blog][image] 업로드 대기 초과 — 발행 단계로 진행',
    }).catch(() => {});
    return true;
  }

  await chooser.setFiles(localPath);
  if (!options?.keepCaret) {
    await preparePointerForPublishAfterImage(page);
  } else {
    await dismissSeOneMaterialPopup(page);
  }
  await humanSleep(800, 1600);
  const loaded = await waitForBlogImageLoaded(page);
  if (loaded) return true;
  if (await isBlogImagePresentInBody(page)) return true;
  await logOperation({
    level: 'warn',
    message: '[post_blog][image] 업로드 대기 초과 — 발행 단계로 진행',
  }).catch(() => {});
  return true;
}

function mimeForImagePath(localPath: string): string {
  const ext = extname(localPath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

/** 본문 캐럿 — 툴바 filechooser 우선, 실패 시 클립보드 붙여넣기 */
export async function pasteBlogImageAtCaret(
  page: Page,
  localPath: string,
  options?: { skipPostReview?: boolean; keepCaret?: boolean },
): Promise<boolean> {
  const viaToolbar = await insertImageViaToolbar(page, localPath, options);
  if (viaToolbar) return true;

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

  if (!clipboardReady) return false;

  await page.keyboard.press('Control+v');
  if (!options?.keepCaret) {
    await preparePointerForPublishAfterImage(page);
  } else {
    await dismissSeOneMaterialPopup(page);
  }
  await humanSleep(2000, 3500);
  return waitForBlogImageLoaded(page);
}

/** @deprecated 툴바 se-image 오탐 — isBlogImageInBodySection 사용 */
export async function isBlogImageInEditor(page: Page): Promise<boolean> {
  return isBlogImageInBodySection(page);
}

/** 툴바 「사진」 → filechooser. 실패 시 hidden input 폴백 */
export async function insertImageViaToolbar(
  page: Page,
  localPath: string,
  options?: { keepCaret?: boolean },
): Promise<boolean> {
  const viaToolbar = await insertFileViaToolbar(
    page,
    localPath,
    {
      dataNames: ['image', 'photo'],
      buttonTexts: ['사진'],
      classHints: ['image-toolbar', 'photo'],
    },
    options,
  );
  if (viaToolbar) return true;

  const fileInput = await findVisibleLocator(
    page,
    ['input[type="file"]', '#mainFrame input[type="file"]'],
    { inFrame: false },
  );
  if (fileInput) {
    await fileInput.setInputFiles(localPath);
    if (!options?.keepCaret) {
      await preparePointerForPublishAfterImage(page);
    } else {
      await dismissSeOneMaterialPopup(page);
    }
    await humanSleep(800, 1600);
    if (await waitForBlogImageLoaded(page)) return true;
    if (await isBlogImagePresentInBody(page)) return true;
    return true;
  }

  const fallback = page.locator('input[type="file"]').first();
  if ((await fallback.count()) > 0) {
    await fallback.setInputFiles(localPath);
    if (!options?.keepCaret) {
      await preparePointerForPublishAfterImage(page);
    } else {
      await dismissSeOneMaterialPopup(page);
    }
    await humanSleep(800, 1600);
    if (await waitForBlogImageLoaded(page)) return true;
    if (await isBlogImagePresentInBody(page)) return true;
    return true;
  }

  return false;
}

/** 툴바 「동영상」 — video_path 있을 때만 호출 */
export async function insertVideoViaToolbar(page: Page, localPath: string): Promise<boolean> {
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 12_000 }).catch(() => null);
  const clicked = await clickEditorToolbar(page, {
    dataNames: ['video', 'movie'],
    buttonTexts: ['동영상', '영상'],
    classHints: ['video-toolbar', 'movie'],
  });
  if (!clicked) return false;

  const chooser = await chooserPromise;
  if (!chooser) return false;

  await chooser.setFiles(localPath);
  await humanSleep(2000, 4500);
  return true;
}
