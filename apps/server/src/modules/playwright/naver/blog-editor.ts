import type { Locator, Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';

import { scrollReview, scaledHumanSleep, typePostContent } from '../../human-engine/timing.js';

import { calcReviewDurationMs } from '../../../lib/review-duration.js';

import type { HumanEngineConfig } from '../../../lib/settings.js';

import { parsePersona, type AccountPersona } from '../persona.js';

import {
  enterBlogEditor,
  dismissNaverBlogEditorOverlays,
  waitAndDismissDraftResumePopup,
} from './enter-blog-editor.js';
import {
  clearSeOneEditorFormatting,
  findBlogTitleLocator,
  findBlogBodyLocator,
  isDraftResumePopupVisible,
} from './naver-editor-locators.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { pasteBlogLinkWithOgPreview } from './paste-blog-link.js';
import { insertImageViaToolbar, insertVideoViaToolbar } from './naver-editor-media.js';
import { completeNaverPublishDialog } from './naver-publish-dialog.js';
import { randomBetween, sleep } from '../../../lib/utils.js';

function mergePersonaConfig(base: HumanEngineConfig, persona: AccountPersona): HumanEngineConfig {
  return {
    ...base,
    wpm_mean: persona.wpm,
    typo_rate: persona.typoRate,
  };
}

async function readTitleText(titleLoc: Locator): Promise<string> {
  const inputVal = await titleLoc.inputValue().catch(() => '');
  if (inputVal.trim()) return inputVal.trim();
  const text = await titleLoc.textContent().catch(() => '');
  return (text ?? '').trim();
}

/** SE ONE 제목 — insertText + 입력 검증 */
async function typeBlogTitle(page: Page, titleLoc: Locator, title: string): Promise<void> {
  await titleLoc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  await humanClickLocator(page, titleLoc);
  await sleep(randomBetween(200, 400));
  await clearSeOneEditorFormatting(page);
  await humanClickLocator(page, titleLoc);
  await sleep(120);
  await page.keyboard.press('Control+A').catch(() => {});
  await sleep(80);
  await page.keyboard.insertText(title);
  await sleep(randomBetween(300, 450));

  const written = await readTitleText(titleLoc);
  if (!written || !title.startsWith(written.slice(0, Math.min(4, written.length)))) {
    await titleLoc.fill(title).catch(() => page.keyboard.insertText(title));
    await sleep(300);
  }
}

/** SE ONE 본문 — 문단별 insertText (Ctrl+V 붙여넣기·취소선 서식 잔여 방지) */
async function typeSeOneBlogBody(
  page: Page,
  bodyLoc: Locator,
  content: string,
  config: HumanEngineConfig,
): Promise<void> {
  const paragraphs = content.split('\n\n').filter(Boolean);
  const paraPauseMin = Math.min(config.paragraph_pause_ms[0], 1200);
  const paraPauseMax = Math.min(config.paragraph_pause_ms[1], 3500);

  for (let i = 0; i < paragraphs.length; i += 1) {
    if (await isDraftResumePopupVisible(page)) {
      await waitAndDismissDraftResumePopup(page, 8_000);
    }
    await clearSeOneEditorFormatting(page);
    await humanClickLocator(page, bodyLoc);
    await sleep(randomBetween(150, 300));
    await page.keyboard.insertText(paragraphs[i]!);
    await sleep(randomBetween(200, 400));
    if (i < paragraphs.length - 1) {
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await humanSleep(paraPauseMin, paraPauseMax);
    }
  }
}

function isSeOnePostwrite(page: Page): boolean {
  return /postwrite|PostWriteForm|GoBlogWrite/i.test(page.url());
}

export async function postNaverBlog(params: {
  page: Page;
  title: string;
  content: string;
  imageUrls?: string[];
  linkUrl?: string;
  hashtags?: string[];
  blogCategory?: string;
  videoPath?: string;
  workspace?: string;
  humanEngine: HumanEngineConfig;
  persona?: AccountPersona;
  rttScale?: number;
  accountId?: string;
}) {
  const persona = parsePersona(params.persona);
  const config = mergePersonaConfig(params.humanEngine, persona);
  const scale = params.rttScale ?? 1;

  const page = await enterBlogEditor(params.page, config, { accountId: params.accountId });
  await waitAndDismissDraftResumePopup(page, 20_000);
  await dismissNaverBlogEditorOverlays(page);
  await clearSeOneEditorFormatting(page);

  const titleBox = await findBlogTitleLocator(page);
  if (!titleBox) {
    throw new Error('BLOG_TITLE_NOT_FOUND');
  }
  await typeBlogTitle(page, titleBox, params.title);
  const titleWritten = await readTitleText(titleBox);
  if (!titleWritten || titleWritten.length < 2) {
    throw new Error('BLOG_TITLE_WRITE_FAILED');
  }
  await scaledHumanSleep(500, 1200, scale);

  await waitAndDismissDraftResumePopup(page, 8_000);
  await dismissNaverBlogEditorOverlays(page);
  await clearSeOneEditorFormatting(page);

  const editor = await findBlogBodyLocator(page);
  if (!editor) {
    throw new Error('BLOG_BODY_NOT_FOUND');
  }

  if (isSeOnePostwrite(page)) {
    await typeSeOneBlogBody(page, editor, params.content, config);
  } else {
    await humanClickLocator(page, editor);
    await sleep(randomBetween(200, 400));
    await typePostContent(page, editor, params.content, config);
  }

  if (params.linkUrl?.trim()) {
    await pasteBlogLinkWithOgPreview(page, editor, params.linkUrl.trim(), {
      workspace: params.workspace ?? 'yeonun',
      scale,
      humanConfig: config,
    });
  }

  if (params.imageUrls?.length) {
    for (const imagePath of params.imageUrls) {
      await insertImageViaToolbar(page, imagePath);
      await scaledHumanSleep(1000, 3000, scale);
    }
  }

  if (params.videoPath?.trim()) {
    await insertVideoViaToolbar(page, params.videoPath.trim());
    await scaledHumanSleep(1500, 3500, scale);
  }

  await scrollReview(
    page,
    calcReviewDurationMs(
      params.title.length + params.content.length + (params.linkUrl?.length ?? 0),
      config.review_duration_ms,
    ),
  );

  await completeNaverPublishDialog({
    page,
    workspace: params.workspace,
    category: params.blogCategory,
    hashtags: params.hashtags,
    humanConfig: config,
    scale,
  });

  await humanSleep(1000, 2000);
  return { resultUrl: page.url() };
}
