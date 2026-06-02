import type { Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';

import type { HumanEngineConfig } from '../../../lib/settings.js';

import { notifySlack } from '../../watcher/detector.js';

import { humanClickLocator } from '../../human-engine/mouse.js';



/** v3.25 ㉒ — blog.naver.com/write 직접 접속 금지 */

export async function enterBlogEditor(_page: Page, _humanEngine: HumanEngineConfig) {

  await _page.goto('https://blog.naver.com');

  await humanSleep(1000, 2500);

  const writeBtn = _page.locator('.btn_write, [class*="write"]').first();

  if (!(await writeBtn.count())) {

    const message = '블로그 글쓰기 버튼을 찾을 수 없습니다 (write URL 직접 접속 금지)';

    await notifySlack(message);

    throw new Error('BLOG_WRITE_BTN_NOT_FOUND');

  }

  await humanClickLocator(_page, writeBtn);

  await _page.waitForLoadState('networkidle');

}


