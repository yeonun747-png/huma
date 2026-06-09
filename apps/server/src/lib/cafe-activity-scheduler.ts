import { supabase } from '../middleware/auth.js';
import { logOperation } from './log-emitter.js';
import {
  executeSelfQAPhase,
  listDuePendingSelfQAPosts,
  parseSelfQAMeta,
} from '../modules/cafe/activity.js';
import { assertCafeWarmupComplete } from './cafe-viral-config.js';
import { withNaverBrowserSession } from './naver-browser-session.js';
import { getSystemPaused } from './system-pause.js';

let processing = false;

export async function processPendingSelfQAPosts(): Promise<void> {
  if (getSystemPaused()) return;
  if (processing) return;
  processing = true;

  try {
    const due = await listDuePendingSelfQAPosts(3);
    if (!due.length) return;

    for (const row of due) {
      const meta = parseSelfQAMeta(row.reply_drafted);
      // 답변(reply) 단계는 질문 작성 계정과 분리된 reply_account_id로 실행 (셀프 댓글 탐지 회피).
      const sessionAccountId =
        meta?.phase === 'reply'
          ? (meta.reply_account_id ?? row.account_id ?? meta?.account_id)
          : (row.account_id ?? meta?.account_id);
      if (!sessionAccountId) continue;

      const { data: post } = await supabase
        .from('huma_cafe_viral_posts')
        .select('cafe_id')
        .eq('id', row.id)
        .single();
      if (!post?.cafe_id) continue;

      try {
        await assertCafeWarmupComplete(sessionAccountId, post.cafe_id);
        await withNaverBrowserSession(sessionAccountId, async ({ page }) => {
          await executeSelfQAPhase({ postId: row.id, accountId: sessionAccountId, page });
        });
        await logOperation({
          level: 'info',
          message: `[cafe-scheduler] 자문자답 ${meta?.phase ?? '?'} 완료 · post ${row.id}`,
          account_id: sessionAccountId,
        });
      } catch (err) {
        await logOperation({
          level: 'warn',
          message: `[cafe-scheduler] 자문자답 실패: ${(err as Error).message}`,
          account_id: sessionAccountId,
        });
      }
    }
  } finally {
    processing = false;
  }
}

export function startCafeActivityScheduler(): void {
  setInterval(() => {
    processPendingSelfQAPosts().catch((err) =>
      console.error('[cafe-scheduler] self_qa:', err),
    );
  }, 60_000);
  processPendingSelfQAPosts().catch((err) =>
    console.error('[cafe-scheduler] self_qa initial:', err),
  );
}
