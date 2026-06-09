import type { Page } from 'playwright';

import { humanType, humanSleep } from '../../human-engine/typing.js';

import { scrollReview, scaledHumanSleep, typePostContent } from '../../human-engine/timing.js';

import { calcReviewDurationMs } from '../../../lib/review-duration.js';

import type { HumanEngineConfig } from '../../../lib/settings.js';

import { parsePersona, type AccountPersona } from '../persona.js';

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

  // 에디터는 새 탭으로 열릴 수 있으므로 실제 에디터 페이지를 받아 이후 작업에 사용.
  const page = await enterBlogEditor(params.page, config);

  const titleBox = page.locator('#subjectTextBox');
  await humanClickLocator(page, titleBox);
  await humanType(page, titleBox, params.title, config);
  await scaledHumanSleep(2000, 5000, scale);

  const editor = page.frameLocator('#mainFrame').locator('.se-content');
  await humanClickLocator(page, editor);

  await typePostContent(page, editor, params.content, config);

  if (params.linkUrl?.trim()) {
    await pasteBlogLinkWithOgPreview(page, editor, params.linkUrl.trim(), {
      workspace: params.workspace ?? 'yeonun',
      scale,
      humanConfig: config,
    });
  }

  if (params.imageUrls?.length) {
    // post-blog에서 이미 uniquify된 로컬 경로 — 재처리 없이 그대로 삽입
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
