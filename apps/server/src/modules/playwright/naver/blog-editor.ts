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
import { findBlogTitleLocator, findBlogBodyLocator } from './naver-editor-locators.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { humanPasteIntoElement } from '../../human-engine/korean-ime.js';
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

/** SE ONE 제목 — insertText (합성 IME·팝업 간섭 방지) */
async function typeBlogTitle(page: Page, titleLoc: Locator, title: string): Promise<void> {
  await titleLoc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  await humanClickLocator(page, titleLoc);
  await sleep(randomBetween(200, 450));
  await page.keyboard.press('Control+A').catch(() => {});
  await sleep(80);
  await page.keyboard.insertText(title);
  await sleep(randomBetween(300, 450));
}

/** SE ONE 본문 — 문단별 붙여넣기 (ProseMirror·합성 IME 호환) */
async function typeSeOneBlogBody(
  page: Page,
  bodyLoc: Locator,
  content: string,
  config: HumanEngineConfig,
): Promise<void> {
  const paragraphs = content.split('\n\n').filter(Boolean);
  for (let i = 0; i < paragraphs.length; i += 1) {
    await humanClickLocator(page, bodyLoc);
    await sleep(randomBetween(150, 350));
    await humanPasteIntoElement(page, bodyLoc, paragraphs[i]!);
    if (i < paragraphs.length - 1) {
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await humanSleep(config.paragraph_pause_ms[0], config.paragraph_pause_ms[1]);
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

  const titleBox = await findBlogTitleLocator(page);
  if (!titleBox) {
    throw new Error('BLOG_TITLE_NOT_FOUND');
  }
  await typeBlogTitle(page, titleBox, params.title);
  await scaledHumanSleep(800, 1800, scale);

  await waitAndDismissDraftResumePopup(page, 5_000);
  await dismissNaverBlogEditorOverlays(page);

  const editor = await findBlogBodyLocator(page);
  if (!editor) {
    throw new Error('BLOG_BODY_NOT_FOUND');
  }
  await humanClickLocator(page, editor);
  await sleep(randomBetween(200, 400));

  if (isSeOnePostwrite(page)) {
    await typeSeOneBlogBody(page, editor, params.content, config);
  } else {
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
