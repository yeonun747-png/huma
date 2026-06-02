import { supabase } from '../middleware/auth.js';
import { logOperation } from './log-emitter.js';
import { createBrowserForAccount, closeBrowserContext } from '../modules/playwright/browser.js';
import { loadAccountForBrowser } from '../modules/playwright/account-loader.js';
import { naverLogin } from '../modules/playwright/naver/login.js';
import {
  executeSelfQAPhase,
  listDuePendingSelfQAPosts,
  parseSelfQAMeta,
} from '../modules/cafe/activity.js';
import { assertCafeWarmupComplete } from './cafe-viral-config.js';

let processing = false;

export async function processPendingSelfQAPosts(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    const due = await listDuePendingSelfQAPosts(3);
    if (!due.length) return;

    for (const row of due) {
      const meta = parseSelfQAMeta(row.reply_drafted);
      const accountId = row.account_id ?? meta?.account_id;
      if (!accountId) continue;

      const { data: post } = await supabase
        .from('huma_cafe_viral_posts')
        .select('cafe_id')
        .eq('id', row.id)
        .single();
      if (!post?.cafe_id) continue;

      try {
        await assertCafeWarmupComplete(accountId, post.cafe_id);
      } catch {
        continue;
      }

      const accountCtx = await loadAccountForBrowser(accountId);
      const { context } = await createBrowserForAccount(accountCtx);

      try {
        await naverLogin(context, accountId);
        const page = await context.newPage();
        await executeSelfQAPhase({ postId: row.id, accountId, page });
        await logOperation({
          level: 'info',
          message: `[cafe-scheduler] 자문자답 ${meta?.phase ?? '?'} 완료 · post ${row.id}`,
          account_id: accountId,
        });
      } catch (err) {
        await logOperation({
          level: 'warn',
          message: `[cafe-scheduler] 자문자답 실패: ${(err as Error).message}`,
          account_id: accountId,
        });
      } finally {
        await closeBrowserContext(context);
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
