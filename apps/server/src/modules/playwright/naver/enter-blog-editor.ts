import type { Page } from 'playwright';

import { humanSleep } from '../../human-engine/typing.js';

import type { HumanEngineConfig } from '../../../lib/settings.js';

import { notifySlack } from '../../watcher/detector.js';

import { humanClickLocator } from '../../human-engine/mouse.js';
import { vncFastSleepScale } from '../../../lib/vnc-session.js';
import { ensureBlogWriteEntry } from '../../../lib/naver-blog-portal.js';

function scaledSleep(min: number, max: number): Promise<void> {
  const s = vncFastSleepScale();
  return humanSleep(Math.round(min * s), Math.round(max * s));
}

/**
 * v3.25 ㉒ — blog.naver.com/write 직접 접속 금지.
 * BlogHome(section.blog) 렌더를 기다린 뒤 프로필 카드 「글쓰기」 또는 개인 블로그
 * .btn_write 를 클릭한다. 글쓰기는 새 탭(팝업)으로 열릴 수 있으며,
 * SmartEditor ONE 의 #mainFrame·.se-content 가 실제로 준비될 때까지 대기한다.
 * 반환값: 에디터가 떠 있는 Page (팝업이면 팝업, 아니면 동일 페이지).
 */
export async function enterBlogEditor(_page: Page, _humanEngine: HumanEngineConfig): Promise<Page> {
  const writeBtn = await ensureBlogWriteEntry(_page);

  if (!writeBtn) {
    const message =
      '블로그 글쓰기 진입점을 찾을 수 없습니다 (BlogHome 렌더 실패 또는 로그아웃 상태)';
    await notifySlack(message);
    throw new Error('BLOG_WRITE_BTN_NOT_FOUND');
  }

  await scaledSleep(800, 2000);

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
