import type { BrowserContext } from 'playwright';

import { supabase } from '../middleware/auth.js';
import { getHumanEngineConfig } from './settings.js';
import { logOperation } from './log-emitter.js';
import { scheduleRepeatIfNeeded } from './repeat-scheduler.js';
import type { JobRecord } from './job-scheduler.js';
import { loadAccountForBrowser } from '../modules/playwright/account-loader.js';
import { naverLogin } from '../modules/playwright/naver/login.js';
import { parsePersona } from '../modules/playwright/persona.js';
import {
  acquireWorkflowPage,
  closeBrowserContext,
  closeIdleBlankTabs,
} from '../modules/playwright/browser.js';
import { executePostBlog } from '../modules/queue/jobs/post-blog.js';
import { releaseModem, type ModemSession } from '../modules/proxy/manager.js';
import {
  ensurePostingSessionAfterCaptcha,
  pickPostingWorkflowPage,
} from './posting-captcha-session.js';

async function incrementPostCount(accountId: string): Promise<void> {
  const { data } = await supabase.from('huma_accounts').select('post_count_today').eq('id', accountId).single();
  const current = (data?.post_count_today as number | undefined) ?? 0;
  await supabase.from('huma_accounts').update({ post_count_today: current + 1 }).eq('id', accountId);
}

/** CAPTCHA hold — 브라우저·로그인 세션 유지한 채 post_blog 이어하기 (재큐·재브라우저 금지) */
export async function continuePostBlogFromCaptchaHold(params: {
  jobId: string;
  accountId: string;
  context: BrowserContext;
  modemSession?: ModemSession;
  payload: Record<string, unknown>;
  releaseAccountLock: () => void;
  workspace?: string | null;
}): Promise<{ ok: boolean; resultUrl?: string; error?: string }> {
  const { jobId, accountId, context, modemSession, payload, releaseAccountLock, workspace } = params;

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
    const captchaCtx = {
      humaJobId: jobId,
      accountId,
      workspace,
      jobType: 'post_blog',
    };

    await closeIdleBlankTabs(context);

    const runPostBlog = async () => {
      const page = pickPostingWorkflowPage(context) ?? (await acquireWorkflowPage(context));
      return executePostBlog({
        page,
        payload,
        humanConfig,
        persona,
        rttScale: 1,
      });
    };

    const sessionOk = await ensurePostingSessionAfterCaptcha(context, accountId);
    if (!sessionOk) {
      await naverLogin(context, accountId, {
        profilePath: accountCtx.profile_path,
        skipShadowWalk: true,
        captchaContext: captchaCtx,
        keepSessionPage: true,
      });
    }

    let resultUrl: string;
    try {
      ({ resultUrl } = await runPostBlog());
    } catch (postErr) {
      const msg = (postErr as Error).message ?? '';
      if (msg.includes('BLOG_WRITE_BTN_NOT_FOUND') || msg.includes('BLOG_EDITOR_NOT_READY')) {
        await naverLogin(context, accountId, {
          profilePath: accountCtx.profile_path,
          skipShadowWalk: true,
          captchaContext: captchaCtx,
          keepSessionPage: true,
        });
        ({ resultUrl } = await runPostBlog());
      } else {
        throw postErr;
      }
    }

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
    await closeBrowserContext(context).catch(() => {});
    if (modemSession) await releaseModem(modemSession).catch(() => {});
    releaseAccountLock();
  }
}
