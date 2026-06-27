import type { BrowserContext } from 'playwright';

import { applyNaverResourceBlocking } from './naver-resource-block.js';

/**
 * post_blog — 포털·워밍업 데이터 절약 (CSS·아이콘 유지, 배너 사진 차단).
 * 에디터(postwrite)·업로드 본문 이미지는 허용. 원격접속과 동일 규칙.
 */
export async function applyPostingResourceBlocking(context: BrowserContext): Promise<void> {
  await applyNaverResourceBlocking(context);
}
