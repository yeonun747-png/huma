import type { Locator, Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';
import { scrollReview, scaledHumanSleep } from '../../human-engine/timing.js';
import { calcReviewDurationMs } from '../../../lib/review-duration.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import { parsePersona, type AccountPersona } from '../persona.js';
import {
  enterBlogEditor,
  prepareSeOneEditorSurface,
} from './enter-blog-editor.js';
import {
  findBlogTitleLocator,
  ensureBlogBodyLocator,
  clickBlogBodyPlaceholder,
  pasteBlogBodyContent,
  pasteBlogTitleField,
  blurBlogTitleField,
  resolveBodyEditableLocator,
  isBlogTitleWritten,
  isBlogBodySubstantiallyWritten,
  readBlogBodyText,
  readBlogTitleText,
  waitForBlogTitleSectionReady,
  waitForSeOneEditorFullyLoaded,
  isBlogTitleEditableVisible,
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
import { logOperation } from '../../../lib/log-emitter.js';

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

/** SE ONE 제목 — 마우스 1회 클릭 후 붙여넣기 */
async function typeBlogTitle(page: Page, titleLoc: Locator, title: string): Promise<void> {
  const existing = await readBlogTitleText(titleLoc);
  if (isBlogTitleWritten(existing, title)) return;

  await pasteBlogTitleField(page, titleLoc, title);
  await sleep(randomBetween(300, 500));
  await assertTitleStable(page, titleLoc, title);
}

/** SE ONE 본문 — placeholder 클릭 후 붙여넣기 */
async function typeSeOneBlogBody(
  page: Page,
  bodyLoc: Locator,
  content: string,
): Promise<void> {
  await pasteBlogBodyContent(page, bodyLoc, content);
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

  await logOperation({
    level: 'info',
    message: '[post_blog] 에디터 진입 완료 — 본체 로딩 대기',
    account_id: params.accountId,
  });

  await prepareSeOneEditorSurface(page, 12_000);

  // 발행 버튼만 보이는 스켈레톤·로딩 스피너 단계에서 조기 클릭 방지 —
  // 툴바·제목·본문이 모두 그려지고 제목 위치가 안정될 때까지 대기
  const fullyLoaded = await waitForSeOneEditorFullyLoaded(page, 45_000);
  await logOperation({
    level: 'info',
    message: `[post_blog] 본체 로딩 ${fullyLoaded ? '완료' : '대기 timeout(폴백 진행)'} — 제목칸 클릭·입력 시작`,
    account_id: params.accountId,
  });

  await prepareSeOneEditorSurface(page, 6_000);
  if (!(await isBlogTitleEditableVisible(page))) {
    await waitForBlogTitleSectionReady(page, 8_000).catch(() => {});
  }

  const titleBox = await findBlogTitleLocator(page);
  if (!titleBox) {
    throw new Error('BLOG_TITLE_NOT_FOUND');
  }

  await typeBlogTitle(page, titleBox, params.title);
  await logOperation({
    level: 'info',
    message: '[post_blog] 제목 입력 완료 — 본문 placeholder 클릭·입력 시작',
    account_id: params.accountId,
  });
  await scaledHumanSleep(300, 600, scale);

  await clickBlogBodyPlaceholder(page);
  await blurBlogTitleField(page);

  const editor = await ensureBlogBodyLocator(page, titleBox);
  if (!editor) {
    throw new Error('BLOG_BODY_NOT_FOUND');
  }

  const bodyEditable = await resolveBodyEditableLocator(editor);
  const bodyWritten = await readBlogBodyText(bodyEditable);
  if (!isBlogBodySubstantiallyWritten(bodyWritten, params.content)) {
    await typeSeOneBlogBody(page, editor, params.content);
  }
  await logOperation({
    level: 'info',
    message: '[post_blog] 본문 입력 완료',
    account_id: params.accountId,
  });

  if (params.linkUrl?.trim()) {
    await prepareSeOneEditorSurface(page, 6_000);
    await blurBlogTitleField(page);
    await clickBlogBodyPlaceholder(page);
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
    await logOperation({
      level: 'info',
      message: '[post_blog] 발행 버튼 클릭·게시판·해시태그 입력 시작',
      account_id: params.accountId,
    });
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
