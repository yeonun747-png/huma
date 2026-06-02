import type { Page } from 'playwright';
import { humanType, humanSleep } from '../../human-engine/typing.js';
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
  await editor.click();
  for (const para of params.content.split('\n\n')) {
    if (!para.trim()) continue;
    await humanType(params.page, editor, para, params.humanEngine);
    await humanSleep(2000, 6000);
    await params.page.keyboard.press('Enter');
    await params.page.keyboard.press('Enter');
  }

  await frame.locator('.BaseButton--skinGreen, button[class*="submit"]').first().click();
  await params.page.waitForLoadState('networkidle');
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

  const commentBox = params.page.locator('.CommentBox textarea, .comment_inbox textarea, .u_cbox_write_area textarea').first();
  await commentBox.click();
  await humanSleep(500, 1500);
  await humanType(params.page, commentBox, replyContent, params.humanEngine);
  await humanSleep(1000, 2500);
  await params.page.locator('.CommentBox .BaseButton, .comment_inbox .btn_register, .u_cbox_btn_upload').first().click();
  return { success: true, replyContent };
}

/** @deprecated JEOMSAMO 전용 — writeGenericCafePost 사용 권장 */
export { JEOMSAMO };
