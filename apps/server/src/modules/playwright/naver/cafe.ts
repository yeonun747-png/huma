import type { Page } from 'playwright';
import { humanType, humanSleep } from '../../human-engine/typing.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';

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
  await params.page.goto(
    `${JEOMSAMO}?iframe_url=/ArticleWrite.nhn?clubid=${clubId}&menuid=${params.menuId}`
  );
  await params.page.waitForLoadState('networkidle');
  await humanSleep(1500, 3000);

  const frame = params.page.frameLocator('#cafe_main');
  await humanType(params.page, frame.locator('#subject'), params.title, params.humanEngine);
  await humanSleep(1000, 2500);

  const editor = frame.locator('.se-content');
  await editor.click();
  for (const para of params.content.split('\n\n')) {
    await humanType(params.page, editor, para, params.humanEngine);
    await humanSleep(2000, 6000);
    await params.page.keyboard.press('Enter');
    await params.page.keyboard.press('Enter');
  }

  await frame.locator('.BaseButton--skinGreen').click();
  await params.page.waitForLoadState('networkidle');
  return { resultUrl: params.page.url() };
}

export async function writeCafeReply(params: {
  page: Page;
  postUrl: string;
  replyContent: string;
  humanEngine: HumanEngineConfig;
}) {
  await params.page.goto(params.postUrl);
  await params.page.waitForLoadState('networkidle');
  await humanSleep(2000, 4000);

  const { scrollRead } = await import('../../human-engine/timing.js');
  const { randomBetween } = await import('../../../lib/utils.js');
  await scrollRead(params.page, randomBetween(5000, 15000));

  const commentBox = params.page.locator('.CommentBox textarea');
  await commentBox.click();
  await humanSleep(500, 1500);
  await humanType(params.page, commentBox, params.replyContent, params.humanEngine);
  await humanSleep(1000, 2500);
  await params.page.locator('.CommentBox .BaseButton').click();
  return { success: true };
}
