import type { Page } from 'playwright';
import { humanType, humanSleep } from '../../human-engine/typing.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import { randomBetween } from '../../../lib/utils.js';
import {
  generateCafeCommentFromPage,
  type CafeCommentStyle,
} from '../../cafe/cafe-comment.js';
import type { AccountPersona } from '../persona.js';

const JEOMSAMO = 'https://cafe.naver.com/jeomsamo';

export async function writeCafePost(params: {
  page: Page;
  menuId: string;
  title: string;
  content: string;
  imageUrls?: string[];
  humanEngine: HumanEngineConfig;
}) {
  const clubId = process.env.JEOMSAMO_CLUB_ID ?? '';
  return writeGenericCafePost({
    page: params.page,
    cafeSlug: 'jeomsamo',
    clubId,
    menuId: params.menuId,
    title: params.title,
    content: params.content,
    humanEngine: params.humanEngine,
  });
}

export async function writeGenericCafePost(params: {
  page: Page;
  cafeSlug: string;
  clubId: string;
  menuId: string;
  title: string;
  content: string;
  humanEngine: HumanEngineConfig;
}) {
  await params.page.goto(
    `https://cafe.naver.com/${params.cafeSlug}?iframe_url=/ArticleWrite.nhn?clubid=${params.clubId}&menuid=${params.menuId}`,
  );
  await params.page.waitForLoadState('networkidle');
  await humanSleep(1500, 3000);

  const frame = params.page.frameLocator('#cafe_main');
  await humanType(params.page, frame.locator('#subject'), params.title, params.humanEngine);
  await humanSleep(1000, 2500);

  const editor = frame.locator('.se-content, .se-main-container').first();
  await humanClickLocator(params.page, editor);
  for (const para of params.content.split('\n\n')) {
    if (!para.trim()) continue;
    await humanType(params.page, editor, para, params.humanEngine);
    await humanSleep(2000, 6000);
    await params.page.keyboard.press('Enter');
    await params.page.keyboard.press('Enter');
  }

  await humanClickLocator(
    params.page,
    frame.locator('.BaseButton--skinGreen, button[class*="submit"]').first(),
  );
  await params.page.waitForLoadState('networkidle');

  // 게시 성공 검증 — 작성 페이지(ArticleWrite)를 벗어나야 정상. 남아 있으면 실패로 간주.
  const stillOnWritePage = await params.page
    .waitForFunction(() => !/ArticleWrite/i.test(location.href), { timeout: 8000 })
    .then(() => false)
    .catch(() => true);
  if (stillOnWritePage) {
    throw new Error('CAFE_POST_NOT_SUBMITTED');
  }

  return { resultUrl: params.page.url() };
}

export interface WriteCafeReplyOptions {
  page: Page;
  postUrl: string;
  replyContent?: string;
  humanEngine: HumanEngineConfig;
  skipNavigation?: boolean;
  generateComment?: {
    style: CafeCommentStyle;
    workspace?: string;
    persona?: Partial<AccountPersona> & { gender?: string; occupation?: string };
    cafeCategory?: string;
  };
}

export async function writeCafeReply(params: WriteCafeReplyOptions) {
  if (!params.skipNavigation) {
    await params.page.goto(params.postUrl);
    await params.page.waitForLoadState('networkidle');
    await humanSleep(2000, 4000);
  }

  const { scrollRead } = await import('../../human-engine/timing.js');
  await scrollRead(params.page, randomBetween(5000, 15000));

  const replyContent =
    params.replyContent ??
    (params.generateComment
      ? await generateCafeCommentFromPage(params.page, params.generateComment)
      : null);

  if (!replyContent) {
    throw new Error('댓글 내용 없음 — replyContent 또는 generateComment 필요');
  }

  const commentSelector = '.CommentBox textarea, .comment_inbox textarea, .u_cbox_write_area textarea';
  const commentBox = params.page.locator(commentSelector).first();
  await humanClickLocator(params.page, commentBox);
  await humanSleep(500, 1500);
  await humanType(params.page, commentBox, replyContent, params.humanEngine);
  await humanSleep(1000, 2500);
  await humanClickLocator(
    params.page,
    params.page.locator('.CommentBox .BaseButton, .comment_inbox .btn_register, .u_cbox_btn_upload').first(),
  );

  // 등록 성공 검증 — 네이버는 성공 시 입력창을 비운다. 남아 있으면 실패(도배·권한·오류)로 간주.
  await humanSleep(1500, 3000);
  const remaining = await commentBox.inputValue().catch(() => '');
  if (remaining.trim().length > 0) {
    const bodyText = (await params.page.locator('body').innerText().catch(() => '')).slice(0, 2000);
    const blocked = /도배|차단|권한|제한|등업|가입.*회원/.test(bodyText);
    throw new Error(blocked ? 'CAFE_REPLY_BLOCKED' : 'CAFE_REPLY_NOT_SUBMITTED');
  }

  return { success: true, replyContent };
}

/** @deprecated JEOMSAMO 전용 — writeGenericCafePost 사용 권장 */
export { JEOMSAMO };

