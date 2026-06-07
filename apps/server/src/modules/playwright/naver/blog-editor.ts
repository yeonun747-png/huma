import type { Page } from 'playwright';

import { humanType, humanSleep } from '../../human-engine/typing.js';

import { scrollReview, scaledHumanSleep, typePostContent } from '../../human-engine/timing.js';

import { calcReviewDurationMs } from '../../../lib/review-duration.js';

import type { HumanEngineConfig } from '../../../lib/settings.js';

import { parsePersona, type AccountPersona } from '../persona.js';

import { uniquifyImageFromUrl } from '../../image/uniquify.js';

import { enterBlogEditor } from './enter-blog-editor.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { pasteBlogLinkWithOgPreview } from './paste-blog-link.js';
import { insertImageViaToolbar, insertVideoViaToolbar } from './naver-editor-media.js';
import { completeNaverPublishDialog } from './naver-publish-dialog.js';

function mergePersonaConfig(base: HumanEngineConfig, persona: AccountPersona): HumanEngineConfig {
  return {
    ...base,
    wpm_mean: persona.wpm,
    typo_rate: persona.typoRate,
  };
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
}) {
  const persona = parsePersona(params.persona);
  const config = mergePersonaConfig(params.humanEngine, persona);
  const scale = params.rttScale ?? 1;

  await enterBlogEditor(params.page, config);

  const titleBox = params.page.locator('#subjectTextBox');
  await humanClickLocator(params.page, titleBox);
  await humanType(params.page, titleBox, params.title, config);
  await scaledHumanSleep(2000, 5000, scale);

  const editor = params.page.frameLocator('#mainFrame').locator('.se-content');
  await humanClickLocator(params.page, editor);

  await typePostContent(params.page, editor, params.content, config);

  if (params.linkUrl?.trim()) {
    await pasteBlogLinkWithOgPreview(params.page, editor, params.linkUrl.trim(), {
      workspace: params.workspace ?? 'yeonun',
      scale,
      humanConfig: config,
    });
  }

  if (params.imageUrls?.length) {
    for (const url of params.imageUrls) {
      await insertImageViaToolbar(params.page, await uniquifyImageFromUrl(url));
      await scaledHumanSleep(1000, 3000, scale);
    }
  }

  if (params.videoPath?.trim()) {
    await insertVideoViaToolbar(params.page, params.videoPath.trim());
    await scaledHumanSleep(1500, 3500, scale);
  }

  await scrollReview(
    params.page,
    calcReviewDurationMs(
      params.title.length + params.content.length + (params.linkUrl?.length ?? 0),
      config.review_duration_ms,
    ),
  );

  await completeNaverPublishDialog({
    page: params.page,
    workspace: params.workspace,
    category: params.blogCategory,
    hashtags: params.hashtags,
    humanConfig: config,
    scale,
  });

  await humanSleep(1000, 2000);
  return { resultUrl: params.page.url() };
}
