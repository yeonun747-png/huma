import type { Locator, Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';
import { scrollReview, scaledHumanSleep } from '../../human-engine/timing.js';
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
  ensureBlogBodyLocator,
  focusBlogBodyField,
  focusBlogTitleField,
  blurBlogTitleField,
  resolveBodyEditableLocator,
  insertTextIntoBlogEditable,
  insertParagraphBreakInBlogEditable,
  isBlogTitleWritten,
  isBlogBodySubstantiallyWritten,
  readBlogBodyText,
  isDraftResumePopupVisible,
  isFocusInTitleArea,
  readBlogTitleText,
  waitForBlogTitleSectionReady,
  recoverBlogTitleSection,
  isBlogTitleSectionReady,
  typeTextIntoBlogTitleField,
} from './naver-editor-locators.js';
import {
  extractPublishedPostUrl,
  isPostBlogPublishedUrl,
  waitForNaverPublishSuccess,
} from './blog-editor-pipeline.js';
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

async function assertTitleStable(page: Page, titleLoc: Locator, expected: string): Promise<void> {
  const written = await readBlogTitleText(titleLoc);
  if (!isBlogTitleWritten(written, expected)) {
    throw new Error('BLOG_TITLE_WRITE_FAILED');
  }
}

/** SE ONE 제목 — 이미 입력됐으면 스킵(CAPTCHA 재개·재시도 중복 방지) */
async function typeBlogTitle(page: Page, titleLoc: Locator, title: string): Promise<void> {
  if (!(await isBlogTitleSectionReady(page))) {
    await recoverBlogTitleSection(page);
  }

  const existing = await readBlogTitleText(titleLoc);
  if (isBlogTitleWritten(existing, title)) return;

  const freshTitleLoc = (await findBlogTitleLocator(page)) ?? titleLoc;
  if (!(await isBlogTitleSectionReady(page))) {
    await recoverBlogTitleSection(page);
    await waitForBlogTitleSectionReady(page, 12_000);
  }

  await typeTextIntoBlogTitleField(page, freshTitleLoc, title);
  await sleep(randomBetween(300, 500));
  await assertTitleStable(page, freshTitleLoc, title);
}

/** SE ONE 본문 — locator 직접 입력만 사용 (page.keyboard 금지) */
async function typeSeOneBlogBody(
  page: Page,
  bodyLoc: Locator,
  titleLoc: Locator,
  content: string,
  config: HumanEngineConfig,
): Promise<void> {
  const paragraphs = content.split('\n\n').filter(Boolean);
  if (paragraphs.length === 0) return;

  const paraPauseMin = Math.min(config.paragraph_pause_ms[0], 1200);
  const paraPauseMax = Math.min(config.paragraph_pause_ms[1], 3500);

  await prepareSeOneEditorSurface(page, 12_000);
  await blurBlogTitleField(page);
  await clearSeOneEditorFormatting(page);
  await focusBlogBodyField(page, bodyLoc);

  const titleSnapshot = await readBlogTitleText(titleLoc);

  for (let i = 0; i < paragraphs.length; i += 1) {
    if (await isDraftResumePopupVisible(page)) {
      await waitAndDismissDraftResumePopup(page, 10_000);
      await prepareSeOneEditorSurface(page, 8_000);
      await blurBlogTitleField(page);
      await focusBlogBodyField(page, bodyLoc);
    }

    await clearSeOneEditorFormatting(page);
    await blurBlogTitleField(page);
    await focusBlogBodyField(page, bodyLoc);

    const editable = await resolveBodyEditableLocator(bodyLoc);
    if (await isFocusInTitleArea(page)) {
      await blurBlogTitleField(page);
      await focusBlogBodyField(page, bodyLoc);
    }

    await sleep(randomBetween(120, 240));
    await insertTextIntoBlogEditable(page, editable, paragraphs[i]!);
    await sleep(randomBetween(200, 400));

    const titleAfter = await readBlogTitleText(titleLoc);
    if (titleAfter.length > titleSnapshot.length + 8) {
      throw new Error('BLOG_BODY_INSERTED_INTO_TITLE');
    }

    if (i < paragraphs.length - 1) {
      await blurBlogTitleField(page);
      await focusBlogBodyField(page, bodyLoc);
      const breakTarget = await resolveBodyEditableLocator(bodyLoc);
      await insertParagraphBreakInBlogEditable(page, breakTarget, 2);
      await humanSleep(paraPauseMin, paraPauseMax);
    }
  }
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

  const publishedEarly = extractPublishedPostUrl(page.url());
  if (publishedEarly) {
    return { resultUrl: publishedEarly };
  }

  await prepareSeOneEditorSurface(page, 25_000);
  await waitForBlogTitleSectionReady(page, 35_000);

  const titleBox = await findBlogTitleLocator(page);
  if (!titleBox) {
    throw new Error('BLOG_TITLE_NOT_FOUND');
  }

  await typeBlogTitle(page, titleBox, params.title);
  await scaledHumanSleep(400, 900, scale);
  await assertTitleStable(page, titleBox, params.title);

  await prepareSeOneEditorSurface(page, 10_000);
  await blurBlogTitleField(page);

  const editor = await ensureBlogBodyLocator(page, titleBox);
  if (!editor) {
    throw new Error('BLOG_BODY_NOT_FOUND');
  }

  const bodyEditable = await resolveBodyEditableLocator(editor);
  const bodyWritten = await readBlogBodyText(bodyEditable);
  if (!isBlogBodySubstantiallyWritten(bodyWritten, params.content)) {
    await typeSeOneBlogBody(page, editor, titleBox, params.content, config);
  }

  if (params.linkUrl?.trim()) {
    await prepareSeOneEditorSurface(page, 6_000);
    await blurBlogTitleField(page);
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
      const ok = await insertImageViaToolbar(page, imagePath);
      if (!ok) throw new Error('BLOG_IMAGE_INSERT_FAILED');
      await scaledHumanSleep(1000, 3000, scale);
    }
  }

  if (params.videoPath?.trim()) {
    await prepareSeOneEditorSurface(page, 4_000);
    const ok = await insertVideoViaToolbar(page, params.videoPath.trim());
    if (!ok) throw new Error('BLOG_VIDEO_INSERT_FAILED');
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

  if (!isPostBlogPublishedUrl(page.url())) {
    const resultUrl = await completeNaverPublishDialog({
      page,
      workspace: params.workspace,
      category: params.blogCategory,
      hashtags: params.hashtags,
      humanConfig: config,
      scale,
    });
    return { resultUrl };
  }

  await humanSleep(1000, 2000);
  const resultUrl = await waitForNaverPublishSuccess(page);
  return { resultUrl };
}
