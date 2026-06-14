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
  resetDraftDismissGuard,
} from './enter-blog-editor.js';
import {
  findBlogTitleLocator,
  clickBlogBodyPlaceholder,
  pasteBlogBodyContent,
  ensureBlogTitleWritten,
  waitForBlogBodyParagraphLocator,
  blurBlogTitleField,
  verifyBlogBodyField,
  verifyBlogTitleField,
  waitForBlogTitleInputReady,
  isDraftResumePopupVisible,
} from './naver-editor-locators.js';
import {
  extractPublishedPostUrl,
  isPostBlogPublishedUrl,
  waitForNaverPublishSuccess,
} from './blog-editor-pipeline.js';
import { pasteBlogLinkWithOgPreview } from './paste-blog-link.js';
import { insertImageViaToolbar, insertVideoViaToolbar } from './naver-editor-media.js';
import { completeNaverPublishDialog } from './naver-publish-dialog.js';
import { logOperation } from '../../../lib/log-emitter.js';
import { sleep } from '../../../lib/utils.js';

function mergePersonaConfig(base: HumanEngineConfig, persona: AccountPersona): HumanEngineConfig {
  return {
    ...base,
    wpm_mean: persona.wpm,
    typo_rate: persona.typoRate,
  };
}

async function typeSeOneBlogBody(
  page: Page,
  bodyLoc: Locator,
  content: string,
): Promise<void> {
  await pasteBlogBodyContent(page, bodyLoc, content, { skipClick: true });
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

  // 팝업 없으면 즉시 통과
  await waitAndDismissDraftResumePopup(page, 3_000).catch(() => {});
  resetDraftDismissGuard(page);

  let titleBox = await findBlogTitleLocator(page);
  const titleAlreadyOk =
    titleBox != null && (await verifyBlogTitleField(page, titleBox, params.title));

  if (!titleAlreadyOk) {
    titleBox = await waitForBlogTitleInputReady(page, 45_000, async () => {
      await waitAndDismissDraftResumePopup(page, 8_000).catch(() => {});
      resetDraftDismissGuard(page);
    });
    if (!titleBox) {
      throw new Error('BLOG_TITLE_NOT_FOUND');
    }
    await logOperation({
      level: 'info',
      message: '[post_blog] 제목칸 준비 — 클릭·입력 시작',
      account_id: params.accountId,
    });

    if (await isDraftResumePopupVisible(page)) {
      await prepareSeOneEditorSurface(page, 6_000);
    }

    await ensureBlogTitleWritten(page, titleBox, params.title);
  } else {
    await blurBlogTitleField(page);
    await logOperation({
      level: 'info',
      message: '[post_blog] 제목 이미 입력됨 — 본문 입력으로 진행(재시도 시 제목 마우스 이동 없음)',
      account_id: params.accountId,
    });
  }

  await logOperation({
    level: 'info',
    message: '[post_blog] 제목 입력 완료 — 본문 placeholder 클릭·입력 시작',
    account_id: params.accountId,
  });

  let editor = await waitForBlogBodyParagraphLocator(page, 800);
  const bodyAlreadyOk =
    editor != null && (await verifyBlogBodyField(page, editor, params.content));

  if (!bodyAlreadyOk) {
    if (!editor) {
      await clickBlogBodyPlaceholder(page);
      editor = await waitForBlogBodyParagraphLocator(page, 3_000);
    }
    if (!editor) {
      await logOperation({
        level: 'warn',
        message: '[post_blog][body] paragraph 미검출 — BLOG_BODY_NOT_FOUND',
        account_id: params.accountId,
      }).catch(() => {});
      throw new Error('BLOG_BODY_NOT_FOUND');
    }

    try {
      await typeSeOneBlogBody(page, editor, params.content);
    } catch (bodyErr) {
      await logOperation({
        level: 'warn',
        message: `[post_blog][body] 입력 실패 — ${(bodyErr as Error).message}`,
        account_id: params.accountId,
      }).catch(() => {});
      throw bodyErr;
    }
  }

  if (!editor) {
    throw new Error('BLOG_BODY_NOT_FOUND');
  }
  if (!titleBox) {
    throw new Error('BLOG_TITLE_NOT_FOUND');
  }

  if (!(await verifyBlogBodyField(page, editor, params.content))) {
    await logOperation({
      level: 'warn',
      message: '[post_blog][body] 입력 후 검증 실패 — BLOG_BODY_WRITE_FAILED',
      account_id: params.accountId,
    }).catch(() => {});
    throw new Error('BLOG_BODY_WRITE_FAILED');
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
  if (!(await verifyBlogTitleField(page, titleBox, params.title))) {
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
