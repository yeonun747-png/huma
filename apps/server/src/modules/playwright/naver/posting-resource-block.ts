import type { BrowserContext } from 'playwright';

import { applyNaverResourceBlocking } from './naver-resource-block.js';

/**
 * post_blog — 에디터·포털 데이터 절약.
 * 로컬 filechooser 업로드는 네트워크 route와 무관.
 */
export async function applyPostingResourceBlocking(context: BrowserContext): Promise<void> {
  await applyNaverResourceBlocking(context, 'workflow');
}
