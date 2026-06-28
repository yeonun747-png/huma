import { notifyTelegram } from '../watcher/telegram.js';

export async function notifyBlogCheckIndexParseFailed(blogId: string, workspace?: string | null): Promise<void> {
  await notifyTelegram(`블로그 지수 파싱 실패: ${blogId} — 셀렉터 점검 필요`, workspace);
}
