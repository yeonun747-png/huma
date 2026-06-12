import type { BrowserContext } from 'playwright';

import { supabase } from '../middleware/auth.js';
import { getHumanEngineConfig } from './settings.js';
import { logOperation } from './log-emitter.js';
import { scheduleRepeatIfNeeded } from './repeat-scheduler.js';
import type { JobRecord } from './job-scheduler.js';
import { loadAccountForBrowser } from '../modules/playwright/account-loader.js';
import { parsePersona } from '../modules/playwright/persona.js';
import { closeBrowserContext, closeIdleBlankTabs } from '../modules/playwright/browser.js';
import { executePostBlog } from '../modules/queue/jobs/post-blog.js';
import { releaseModem, type ModemSession } from '../modules/proxy/manager.js';
import { pickPostingWorkflowPage } from './posting-captcha-session.js';
import { sleep } from './utils.js';
import { shouldPreserveBrowserPageForVnc } from '../modules/watcher/captcha-hold.js';

async function incrementPostCount(accountId: string): Promise<void> {
  const { data } = await supabase.from('huma_accounts').select('post_count_today').eq('id', accountId).single();
  const current = (data?.post_count_today as number | undefined) ?? 0;
  await supabase.from('huma_accounts').update({ post_count_today: current + 1 }).eq('id', accountId);
}

const EDITOR_RETRY_MAX = 5;
const EDITOR_RETRY_DELAY_MS = 15_000;

/**
 * CAPTCHA hold — 동일 브라우저·로그인 세션 유지한 채 post_blog 이어하기.
 * 재로그인(naverLogin) 금지 — 새 탭+캡차 재발생 원인.
 */
export async function continuePostBlogFromCaptchaHold(params: {
  jobId: string;
  accountId: string;
  context: BrowserContext;
  modemSession?: ModemSession;
  payload: Record<string, unknown>;
  releaseAccountLock: () => void;
  workspace?: string | null;
  accountLabel?: string;
  jobTitle?: string;
}): Promise<{ ok: boolean; resultUrl?: string; error?: string; reHeld?: boolean }> {
  const {
    jobId,
    accountId,
    context,
    modemSession,
    payload,
    releaseAccountLock,
    workspace,
    accountLabel,
    jobTitle,
  } = params;

  let preserveBrowserSession = false;

  try {
    await supabase
      .from('huma_jobs')
      .update({
        status: 'running',
        error_message: null,
        started_at: new Date().toISOString(),
        advance_requested_at: null,
      })
      .eq('id', jobId);

    const humanConfig = await getHumanEngineConfig();
    const accountCtx = await loadAccountForBrowser(accountId, modemSession?.proxyPort);
    const persona = parsePersona(accountCtx.persona);

    await closeIdleBlankTabs(context);

    let resultUrl = '';
    let lastErr: Error | undefined;

    for (let attempt = 1; attempt <= EDITOR_RETRY_MAX; attempt += 1) {
      const page = pickPostingWorkflowPage(context);
      if (!page) throw new Error('BLOG_WORKFLOW_PAGE_MISSING');

      try {
        ({ resultUrl } = await executePostBlog({
          page,
          payload,
          humanConfig,
          persona,
          rttScale: 1,
          accountId,
        }));
        lastErr = undefined;
        break;
      } catch (postErr) {
        lastErr = postErr as Error;
        const msg = lastErr.message ?? '';

        if (shouldPreserveBrowserPageForVnc(postErr)) {
          preserveBrowserSession = true;
          const { enterCaptchaHold } = await import('../modules/watcher/captcha-hold.js');
          await logOperation({
            level: 'warn',
            message: `[post_blog] CAPTCHA 후 발행 중 캡차 재발 — hold 재진입 (시도 ${attempt})`,
            job_id: jobId,
            account_id: accountId,
          });
          await enterCaptchaHold({
            jobId,
            accountId,
            workspace,
            accountLabel,
            jobTitle,
            jobType: 'post_blog',
            context,
            modemSession,
            releaseAccountLock,
            payload,
          });
          return { ok: true, reHeld: true };
        }

        if (
          attempt < EDITOR_RETRY_MAX &&
          (msg.includes('BLOG_EDITOR_NOT_READY') || msg.includes('BLOG_WRITE_BTN_NOT_FOUND'))
        ) {
          await logOperation({
            level: 'warn',
            message: `[post_blog] 에디터 로딩 대기 재시도 ${attempt}/${EDITOR_RETRY_MAX} (재로그인 없음)`,
            job_id: jobId,
            account_id: accountId,
          });
          await sleep(EDITOR_RETRY_DELAY_MS);
          continue;
        }
        throw postErr;
      }
    }

    if (lastErr) throw lastErr;

    const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', jobId).single();
    await supabase
      .from('huma_jobs')
      .update({
        status: 'completed',
        result_url: resultUrl,
        completed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', jobId);
    if (job) await scheduleRepeatIfNeeded(job as JobRecord);
    await incrementPostCount(accountId);

    await logOperation({
      level: 'info',
      message: '[post_blog] CAPTCHA 해결 후 동일 세션 발행 완료',
      job_id: jobId,
      account_id: accountId,
    });

    return { ok: true, resultUrl };
  } catch (err) {
    const message = (err as Error).message ?? 'post_blog_continue_failed';
    await supabase
      .from('huma_jobs')
      .update({ status: 'failed', error_message: message, started_at: null })
      .eq('id', jobId);
    await logOperation({
      level: 'ERROR',
      message: `[post_blog] CAPTCHA 후 발행 실패: ${message}`,
      job_id: jobId,
      account_id: accountId,
    });
    return { ok: false, error: message };
  } finally {
    if (!preserveBrowserSession) {
      await closeBrowserContext(context).catch(() => {});
      if (modemSession) await releaseModem(modemSession).catch(() => {});
      releaseAccountLock();
    }
  }
}
