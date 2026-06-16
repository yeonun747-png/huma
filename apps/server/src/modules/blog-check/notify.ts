import { notifyTelegram } from '../watcher/telegram.js';

export async function notifyBlogCheckIndexParseFailed(blogId: string, workspace?: string | null): Promise<void> {
  await notifyTelegram(`블로그 지수 파싱 실패: ${blogId} — 셀렉터 점검 필요`, workspace);
}

export async function notifyBlogCheckCaptcha(blogId: string, label: string, workspace?: string | null): Promise<void> {
  await notifyTelegram(
    `[blog-check] 캡차 감지 — ${label} (${blogId}) 스캔 중단. 잠시 후 재시도하세요.`,
    workspace,
  );
}
