import type { Locator, Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';

import { scrollReview, scaledHumanSleep, typePostContent } from '../../human-engine/timing.js';

import { calcReviewDurationMs } from '../../../lib/review-duration.js';

import type { HumanEngineConfig } from '../../../lib/settings.js';

import { parsePersona, type AccountPersona } from '../persona.js';

import {
  enterBlogEditor,
  prepareSeOneEditorSurface,
  waitAndDismissDraftResumePopup,
} from './enter-blog-editor.js';
import {
  clearSeOneEditorFormatting,
  clearBlogTitleField,
  findBlogTitleLocator,
  findBlogBodyLocator,
  focusBlogBodyField,
  focusBlogTitleField,
  isBlogTitleWritten,
  isDraftResumePopupVisible,
  readBlogTitleText,
} from './naver-editor-locators.js';
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

/** SE ONE 제목 — 포커스 검증 후 insertText (page Ctrl+A 금지) */
async function typeBlogTitle(page: Page, titleLoc: Locator, title: string): Promise<void> {
  await focusBlogTitleField(page, titleLoc);
  await clearBlogTitleField(titleLoc);
  await sleep(randomBetween(80, 160));
  await page.keyboard.insertText(title);
  await sleep(randomBetween(300, 500));

  let written = await readBlogTitleText(titleLoc);
  if (!isBlogTitleWritten(written, title)) {
    await focusBlogTitleField(page, titleLoc);
    await clearBlogTitleField(titleLoc);
    await titleLoc.fill(title).catch(async () => {
      await page.keyboard.insertText(title);
    });
    await sleep(350);
    written = await readBlogTitleText(titleLoc);
  }

  if (!isBlogTitleWritten(written, title)) {
    throw new Error('BLOG_TITLE_WRITE_FAILED');
  }
}

/** SE ONE 본문 — 제목 입력 확인 후 문단별 insertText */
async function typeSeOneBlogBody(
  page: Page,
  bodyLoc: Locator,
  content: string,
  config: HumanEngineConfig,
): Promise<void> {
  const paragraphs = content.split('\n\n').filter(Boolean);
  const paraPauseMin = Math.min(config.paragraph_pause_ms[0], 1200);
  const paraPauseMax = Math.min(config.paragraph_pause_ms[1], 3500);

  await prepareSeOneEditorSurface(page, 12_000);
  await clearSeOneEditorFormatting(page);
  await focusBlogBodyField(page, bodyLoc);

  for (let i = 0; i < paragraphs.length; i += 1) {
    if (await isDraftResumePopupVisible(page)) {
      await waitAndDismissDraftResumePopup(page, 10_000);
      await prepareSeOneEditorSurface(page, 8_000);
      await focusBlogBodyField(page, bodyLoc);
    }

    await clearSeOneEditorFormatting(page);
    await focusBlogBodyField(page, bodyLoc);
    await sleep(randomBetween(120, 240));
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
  await prepareSeOneEditorSurface(page, 25_000);

  const titleBox = await findBlogTitleLocator(page);
  if (!titleBox) {
    throw new Error('BLOG_TITLE_NOT_FOUND');
  }

  await typeBlogTitle(page, titleBox, params.title);
  await scaledHumanSleep(400, 900, scale);

  const titleWritten = await readBlogTitleText(titleBox);
  if (!isBlogTitleWritten(titleWritten, params.title)) {
    throw new Error('BLOG_TITLE_WRITE_FAILED');
  }

  await prepareSeOneEditorSurface(page, 10_000);

  const editor = await findBlogBodyLocator(page);
  if (!editor) {
    throw new Error('BLOG_BODY_NOT_FOUND');
  }

  if (isSeOnePostwrite(page)) {
    await typeSeOneBlogBody(page, editor, params.content, config);
  } else {
    await focusBlogBodyField(page, editor);
    await sleep(randomBetween(200, 400));
    await typePostContent(page, editor, params.content, config);
  }

  if (params.linkUrl?.trim()) {
    await prepareSeOneEditorSurface(page, 6_000);
    await focusBlogBodyField(page, editor);
    await pasteBlogLinkWithOgPreview(page, editor, params.linkUrl.trim(), {
      workspace: params.workspace ?? 'yeonun',
      scale,
      humanConfig: config,
    });
  }

  if (params.imageUrls?.length) {
    for (const imagePath of params.imageUrls) {
      await prepareSeOneEditorSurface(page, 4_000);
      await insertImageViaToolbar(page, imagePath);
      await scaledHumanSleep(1000, 3000, scale);
    }
  }

  if (params.videoPath?.trim()) {
    await prepareSeOneEditorSurface(page, 4_000);
    await insertVideoViaToolbar(page, params.videoPath.trim());
    await scaledHumanSleep(1500, 3500, scale);
  }

  await prepareSeOneEditorSurface(page, 8_000);
  const titleBeforeReview = await readBlogTitleText(titleBox);
  if (!isBlogTitleWritten(titleBeforeReview, params.title)) {
    throw new Error('BLOG_TITLE_LOST_BEFORE_REVIEW');
  }

  await scrollReview(
    page,
    calcReviewDurationMs(
      params.title.length + params.content.length + (params.linkUrl?.length ?? 0),
      config.review_duration_ms,
    ),
  );

  await prepareSeOneEditorSurface(page, 8_000);

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
