import type { Locator, Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';
import { scaledHumanSleep } from '../../human-engine/timing.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import { resolvePasteRatio } from '../../../lib/settings.js';
import { parsePersona, type AccountPersona } from '../persona.js';
import {
  enterBlogEditor,
  prepareSeOneEditorSurface,
  resetDraftDismissGuard,
  resolveDraftResumePopupForJob,
} from './enter-blog-editor.js';
import {
  findBlogTitleLocator,
  blogBodySectionLocator,
  clickBlogBodyPlaceholder,
  typeBlogBodyContent,
  ensureBlogTitleWritten,
  blurBlogTitleField,
  dismissSeOneHelpPanel,
  dismissSeOneMaterialPopup,
  isBlogTitleFilledEnough,
  focusBlogBodyAtEnd,
  readBlogBodySectionText,
  isBlogLinkUrlInBodyText,
  isBlogImagePresentInBody,
  isFocusInTitleArea,
  isBlogBodySubstantiallyWritten,
  shouldSkipTitleRetypeOnBodyResume,
  verifyBlogBodyField,
  waitForBlogTitleInputReady,
  isDraftResumePopupVisible,
} from './naver-editor-locators.js';
import {
  extractPublishedPostUrl,
  isPostBlogPublishedUrl,
  waitForNaverPublishSuccess,
} from './blog-editor-pipeline.js';
import { pasteBlogLinkWithOgPreview } from './paste-blog-link.js';
import { resolveBlogLinkUrl } from '../../../lib/blog-link.js';
import {
  insertVideoViaToolbar,
  pasteBlogImageAtCaret,
} from './naver-editor-media.js';
import { completeNaverPublishDialog } from './naver-publish-dialog.js';
import { performPostMediaBodyReview } from './blog-editor-review.js';
import { logOperation } from '../../../lib/log-emitter.js';
import { sleep } from '../../../lib/utils.js';

function mergePersonaConfig(base: HumanEngineConfig, persona: AccountPersona): HumanEngineConfig {
  return {
    ...base,
    wpm_mean: persona.wpm,
    // typo_rate·backspace_delay_ms — 대시보드 human_engine 설정 우선 (페르소나 typoRate 미적용)
  };
}

async function typeSeOneBlogBody(
  page: Page,
  bodyLoc: Locator,
  content: string,
  humanConfig: HumanEngineConfig,
): Promise<void> {
  await typeBlogBodyContent(page, bodyLoc, content, humanConfig, { afterPlaceholderClick: true });
}

async function isBlogBodyReadyForMediaAppend(
  page: Page,
  editor: Locator,
  content: string,
): Promise<boolean> {
  if (await verifyBlogBodyField(page, editor, content)) return true;
  const sectionText = await readBlogBodySectionText(page);
  return isBlogBodySubstantiallyWritten(sectionText, content);
}

async function isPostBlogPublishResumeReady(params: {
  page: Page;
  editor: Locator;
  content: string;
  linkUrl?: string;
  workspace?: string;
}): Promise<boolean> {
  if (!(await isBlogBodyReadyForMediaAppend(params.page, params.editor, params.content))) {
    return false;
  }
  const workspace = params.workspace ?? 'yeonun';
  const bodyText = await readBlogBodySectionText(params.page);
  const resolvedLink = params.linkUrl?.trim()
    ? resolveBlogLinkUrl(workspace, params.linkUrl.trim(), params.linkUrl.trim())
    : '';
  if (resolvedLink && !isBlogLinkUrlInBodyText(bodyText, resolvedLink)) return false;
  return true;
}

async function isPostBlogMediaStageComplete(params: {
  page: Page;
  editor: Locator;
  content: string;
  linkUrl?: string;
  imagePath?: string;
  workspace?: string;
}): Promise<boolean> {
  if (!(await isPostBlogPublishResumeReady(params))) return false;
  if (params.imagePath && !(await isBlogImagePresentInBody(params.page))) return false;
  return true;
}

/** 본문 insertText 직후 — Enter×2 → 링크 → Enter×1 → 이미지 (포커스·마우스 이동 없음) */
async function appendLinkAndImageAtBodyEnd(params: {
  page: Page;
  editor: Locator;
  linkUrl?: string;
  imagePath?: string;
  workspace?: string;
  scale: number;
  humanConfig: HumanEngineConfig;
  accountId?: string;
}): Promise<void> {
  const { page, scale, humanConfig, accountId } = params;
  const workspace = params.workspace ?? 'yeonun';

  await dismissSeOneHelpPanel(page);
  await dismissSeOneMaterialPopup(page);
  await blurBlogTitleField(page);
  if (await isFocusInTitleArea(page)) {
    throw new Error('BLOG_BODY_INSERTED_INTO_TITLE');
  }
  await focusBlogBodyAtEnd(page, params.editor);

  await logOperation({
    level: 'info',
    message: '[post_blog] 본문 끝 Enter×2 → 링크 (insertText 직후 캐럿, 클릭 없음)',
    account_id: accountId,
  }).catch(() => {});

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await sleep(200);

  const bodyText = await readBlogBodySectionText(page);
  const resolvedLink = params.linkUrl?.trim()
    ? resolveBlogLinkUrl(workspace, params.linkUrl.trim(), params.linkUrl.trim())
    : '';

  if (resolvedLink) {
    const linkPresent = isBlogLinkUrlInBodyText(bodyText, resolvedLink);
    if (linkPresent) {
      await logOperation({
        level: 'info',
        message: '[post_blog] 본문에 링크 URL 있음 — 링크 삽입 건너뜀',
        account_id: accountId,
      }).catch(() => {});
    } else {
      await logOperation({
        level: 'info',
        message: '[post_blog] 링크 insertText 시작',
        account_id: accountId,
      }).catch(() => {});
      const { ogPreview } = await pasteBlogLinkWithOgPreview(page, params.editor, resolvedLink, {
        workspace,
        scale,
        humanConfig,
        atCaret: true,
      });
      await logOperation({
        level: 'info',
        message: `[post_blog] 링크 삽입 완료 (OG=${ogPreview ? 'Y' : 'N'})`,
        account_id: accountId,
      }).catch(() => {});
    }
  }

  await page.keyboard.press('Enter');
  await sleep(200);

  if (params.imagePath) {
    await focusBlogBodyAtEnd(page, params.editor);
    const imagePresent = await isBlogImagePresentInBody(page);
    if (imagePresent) {
      await logOperation({
        level: 'info',
        message: '[post_blog] 본문에 이미지 있음 — 이미지 삽입 건너뜀',
        account_id: accountId,
      }).catch(() => {});
    } else {
      await logOperation({
        level: 'info',
        message: '[post_blog] 이미지 삽입 시작 (붙여넣기·툴바 폴백)',
        account_id: accountId,
      }).catch(() => {});
      const ok = await pasteBlogImageAtCaret(page, params.imagePath, { skipPostReview: true });
      if (!ok) {
        await logOperation({
          level: 'warn',
          message: '[post_blog][image] 삽입 미확인 — 본문 검토·발행 계속',
          account_id: accountId,
        }).catch(() => {});
      } else {
        await logOperation({
          level: 'info',
          message: '[post_blog] 이미지 삽입 완료',
          account_id: accountId,
        }).catch(() => {});
      }
    }
  }

  await blurBlogTitleField(page);
  await dismissSeOneMaterialPopup(page);
  await logOperation({
    level: 'info',
    message: '[post_blog] 본문 중앙 검토 스크롤 — 발행 준비',
    account_id: accountId,
  }).catch(() => {});
  await performPostMediaBodyReview(page, scale);
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

  const page = await enterBlogEditor(params.page, config, {
    accountId: params.accountId,
    expectedTitle: params.title,
    expectedContent: params.content,
  });

  const publishedEarly = extractPublishedPostUrl(page.url());
  if (publishedEarly) {
    return { resultUrl: publishedEarly };
  }

  await logOperation({
    level: 'info',
    message: '[post_blog] 에디터 진입 완료 — 본체 로딩 대기',
    account_id: params.accountId,
  });

  const editor = blogBodySectionLocator(page);
  const bodyResumeReady = await isBlogBodyReadyForMediaAppend(page, editor, params.content);
  const publishResumeReady = await isPostBlogPublishResumeReady({
    page,
    editor,
    content: params.content,
    linkUrl: params.linkUrl,
    workspace: params.workspace,
  });
  const mediaStageComplete = await isPostBlogMediaStageComplete({
    page,
    editor,
    content: params.content,
    linkUrl: params.linkUrl,
    imagePath: params.imageUrls?.[0],
    workspace: params.workspace,
  });

  if (bodyResumeReady || mediaStageComplete || publishResumeReady) {
    await resolveDraftResumePopupForJob(page, {
      expectedTitle: params.title,
      expectedContent: params.content,
      preferResume: true,
    });
  } else {
    await resolveDraftResumePopupForJob(page, {
      expectedTitle: params.title,
      expectedContent: params.content,
    });
  }
  resetDraftDismissGuard(page);

  let titleOkThisRun = true;

  if (mediaStageComplete || publishResumeReady) {
    await blurBlogTitleField(page);
    await logOperation({
      level: 'info',
      message: publishResumeReady
        ? '[post_blog] 본문·링크 완료 — 제목 재입력 생략, 검토 스크롤 후 발행'
        : '[post_blog] 본문·링크·이미지 완료 — 제목 재입력 생략, 본문 검토 후 발행',
      account_id: params.accountId,
    }).catch(() => {});
  } else {
    let titleBox = await findBlogTitleLocator(page);

    let titleAlreadyOk =
      titleBox != null && (await isBlogTitleFilledEnough(page, titleBox, params.title));

    if (!titleAlreadyOk && (bodyResumeReady || publishResumeReady) && titleBox) {
      if (await shouldSkipTitleRetypeOnBodyResume(page, titleBox, params.title)) {
        titleAlreadyOk = true;
        await blurBlogTitleField(page);
        await logOperation({
          level: 'info',
          message:
            '[post_blog] 본문 이미 입력됨 — 제목 재타이핑 생략(검증 실패 재시도·링크·이미지 단계로 진행)',
          account_id: params.accountId,
        }).catch(() => {});
      }
    }

    titleOkThisRun = titleAlreadyOk;

    if (!titleAlreadyOk) {
      titleBox = await waitForBlogTitleInputReady(page, 45_000, async () => {
        await resolveDraftResumePopupForJob(page, {
          expectedTitle: params.title,
          expectedContent: params.content,
          preferResume: bodyResumeReady || mediaStageComplete || publishResumeReady,
        });
        resetDraftDismissGuard(page);
      });
      if (!titleBox) {
        throw new Error('BLOG_TITLE_NOT_FOUND');
      }
      await logOperation({
        level: 'info',
        message: '[post_blog] 제목칸 준비 — pressSequentially 타이핑 시작',
        account_id: params.accountId,
      });

      if (await isDraftResumePopupVisible(page)) {
        await prepareSeOneEditorSurface(page, 15_000, {
          expectedTitle: params.title,
          expectedContent: params.content,
        });
      }

      await ensureBlogTitleWritten(page, titleBox, params.title, config);
      titleOkThisRun = true;
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

    let bodyReady =
      bodyResumeReady || (await isBlogBodyReadyForMediaAppend(page, editor, params.content));

    if (!bodyReady) {
      await clickBlogBodyPlaceholder(page);
      const pastePct = Math.round(resolvePasteRatio(config) * 100);
      await logOperation({
        level: 'info',
        message: `[post_blog] 본문 입력 시작 (복붙${pastePct}%·타이핑${100 - pastePct}%)`,
        account_id: params.accountId,
      }).catch(() => {});

      try {
        await typeSeOneBlogBody(page, editor, params.content, config);
      } catch (bodyErr) {
        bodyReady = await isBlogBodyReadyForMediaAppend(page, editor, params.content);
        if (bodyReady) {
          await logOperation({
            level: 'warn',
            message: `[post_blog][body] 입력 오류 후 본문 충분 — 링크·이미지 단계로 진행: ${(bodyErr as Error).message}`,
            account_id: params.accountId,
          }).catch(() => {});
        } else {
          await logOperation({
            level: 'warn',
            message: `[post_blog][body] 입력 실패 — ${(bodyErr as Error).message}`,
            account_id: params.accountId,
          }).catch(() => {});
          throw bodyErr;
        }
      }
      bodyReady = bodyReady || (await isBlogBodyReadyForMediaAppend(page, editor, params.content));
    }

    if (!bodyReady) {
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
  }

  await appendLinkAndImageAtBodyEnd({
    page,
    editor,
    linkUrl: params.linkUrl,
    imagePath: params.imageUrls?.[0],
    workspace: params.workspace,
    scale,
    humanConfig: config,
    accountId: params.accountId,
  });

  if (params.videoPath?.trim()) {
    await prepareSeOneEditorSurface(page, 4_000, { destructiveDraftDismiss: false });
    const ok = await insertVideoViaToolbar(page, params.videoPath.trim());
    if (!ok) throw new Error('BLOG_VIDEO_INSERT_FAILED');
    await scaledHumanSleep(1500, 3500, scale);
  }

  if (!titleOkThisRun) {
    await logOperation({
      level: 'warn',
      message: '[post_blog] 제목 미확정 — 발행 계속 (재검증·검토 생략)',
      account_id: params.accountId,
    }).catch(() => {});
  } else {
    await logOperation({
      level: 'info',
      message: '[post_blog] 제목·본문·미디어 완료 — 검토 생략, 발행으로 진행',
      account_id: params.accountId,
    }).catch(() => {});
  }

  if (!isPostBlogPublishedUrl(page.url())) {
    await prepareSeOneEditorSurface(page, 4_000, { destructiveDraftDismiss: false });
    await logOperation({
      level: 'info',
      message: '[post_blog] 발행 버튼 클릭·카테고리·해시태그·최종 발행',
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
