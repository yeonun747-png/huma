import type { Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';

import type { HumanEngineConfig } from '../../../lib/settings.js';

import { notifySlack } from '../../watcher/detector.js';

import { humanClickLocator } from '../../human-engine/mouse.js';



/**
 * v3.25 ㉒ — blog.naver.com/write 직접 접속 금지.
 * 글쓰기 버튼이 새 탭(팝업)으로 에디터를 여는 경우를 처리하고,
 * SmartEditor ONE의 #mainFrame·.se-content가 실제로 준비될 때까지 대기한다.
 * 반환값: 에디터가 떠 있는 Page (팝업이면 팝업, 아니면 동일 페이지).
 */

export async function enterBlogEditor(_page: Page, _humanEngine: HumanEngineConfig): Promise<Page> {

  await _page.goto('https://blog.naver.com');

  await humanSleep(1000, 2500);

  const writeBtn = _page.locator('.btn_write, [class*="write"]').first();

  if (!(await writeBtn.count())) {

    const message = '블로그 글쓰기 버튼을 찾을 수 없습니다 (write URL 직접 접속 금지)';

    await notifySlack(message);

    throw new Error('BLOG_WRITE_BTN_NOT_FOUND');

  }

  // 클릭 시 새 탭으로 에디터가 열릴 수 있으므로 팝업을 함께 감시한다.
  const popupPromise = _page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await humanClickLocator(_page, writeBtn);
  const popup = await popupPromise;
  const editorPage = popup ?? _page;

  await editorPage.waitForLoadState('domcontentloaded').catch(() => {});

  // SmartEditor 준비 대기 — iframe과 본문 영역이 실제로 보일 때까지.
  try {
    await editorPage.waitForSelector('#mainFrame', { state: 'attached', timeout: 30_000 });
    await editorPage
      .frameLocator('#mainFrame')
      .locator('.se-content')
      .waitFor({ state: 'visible', timeout: 30_000 });
  } catch {
    await notifySlack('블로그 에디터(SmartEditor) 로딩 실패 — #mainFrame/.se-content 미표시');
    throw new Error('BLOG_EDITOR_NOT_READY');
  }

  return editorPage;

}


