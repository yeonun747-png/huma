import { Worker } from 'bullmq';
import { redisConnection } from './producer.js';
import { supabase } from '../../middleware/auth.js';
import { createBrowserForAccount, closeBrowserContext, createBrowser } from '../playwright/browser.js';
import { loadAccountForBrowser } from '../playwright/account-loader.js';
import { naverLogin } from '../playwright/naver/login.js';
import { preSessionWarmup } from '../playwright/naver/pre-session-warmup.js';
import { parsePersona } from '../playwright/persona.js';
import { measureRTT, rttScale } from '../human-engine/timing.js';
import { getHumanEngineConfig } from '../../lib/settings.js';
import {
  checkMinPublishInterval,
  getEffectiveDailyLimit,
  getHumanEngineScheduleConfig,
  isNightBanActive,
  msUntilNextActiveHour,
  passesActiveHoursGate,
  passesWeekendVolumeGate,
} from '../../lib/human-engine-policy.js';
import { handleLayer4Detection, isCaptchaError, isBlockError } from '../watcher/detector.js';
import { acquireModem, releaseModem, type ModemSession } from '../proxy/manager.js';
import { acquireAccount, releaseAccount } from '../../lib/account-lock.js';
import { getCrankDailyLimit } from '../playwright/warmup.js';
import { checkSharedWorkspaceLimit } from '../../lib/shared-limit.js';
import { logOperation } from '../../lib/log-emitter.js';
import { executePostBlog } from './jobs/post-blog.js';
import { executeCafePost } from './jobs/cafe-post.js';
import { executeCafeReply } from './jobs/cafe-reply.js';
import { executeSocialCrank } from './jobs/social-crank.js';
import { executeScheduledSocialCrank } from '../crank/scheduled-session.js';
import { executeVideoPipeline } from './jobs/video-pipeline.js';
import { executeContentFull } from '../claude/auto-content-orchestrator.js';
import { executeSocialPost } from './jobs/social-post.js';
import { scheduleRepeatIfNeeded } from '../../lib/repeat-scheduler.js';
import { activatePendingSocialReplies } from '../../lib/social-reply-chain.js';
import { isSlimDataCapError, scheduleSlimCapRetry } from '../../lib/slim-retry.js';
import { assertCafeNewPostAccount, assertCafeReplyAccount } from '../../lib/cafe-accounts.js';
let systemPaused = false;

export function setSystemPaused(paused: boolean) {
  systemPaused = paused;
}

export function getSystemPaused() {
  return systemPaused;
}

async function getTodayCount(accountId: string, field: 'post_count_today' | 'crank_count_today'): Promise<number> {
  const { data } = await supabase.from('huma_accounts').select(`${field}`).eq('id', accountId).single();
  if (!data) return 0;
  return (data as Record<string, number>)[field] ?? 0;
}

async function incrementAccountCount(accountId: string, field: 'post_count_today' | 'crank_count_today') {
  const current = await getTodayCount(accountId, field);
  await supabase.from('huma_accounts').update({ [field]: current + 1 }).eq('id', accountId);
}

async function completeJob(jobId: string, resultUrl?: string) {
  const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', jobId).single();
  await supabase
    .from('huma_jobs')
    .update({
      status: 'completed',
      ...(resultUrl ? { result_url: resultUrl } : {}),
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId);
  if (job) await scheduleRepeatIfNeeded(job as import('../../lib/job-scheduler.js').JobRecord);
}

const PLAYWRIGHT_JOBS = ['post_blog', 'cafe_new_post', 'cafe_reply'];

function dailyCountField(jobType: string): 'post_count_today' | 'crank_count_today' {
  if (jobType === 'social_crank' || jobType === 'cafe_reply') return 'crank_count_today';
  return 'post_count_today';
}

const PLAYWRIGHT_AND_CRANK = [...PLAYWRIGHT_JOBS, 'social_crank'];
const POSTING_JOBS = ['post_blog', 'cafe_new_post'];

async function deferJob(job: { moveToDelayed: (ts: number) => Promise<void> }, delayMs: number) {
  await job.moveToDelayed(Date.now() + Math.max(60_000, delayMs));
}

export function startWorker(concurrency = Number(process.env.HUMA_WORKER_CONCURRENCY) || 5) {  const worker = new Worker(
    'huma-jobs',
    async (job) => {
      if (systemPaused) throw new Error('SYSTEM_PAUSED');

      const { type, accountId, payload, humaJobId } = job.data as {
        type: string;
        accountId?: string;
        payload: Record<string, unknown>;
        humaJobId?: string;
      };

      if (PLAYWRIGHT_AND_CRANK.includes(type)) {
        if (await isNightBanActive()) {
          await deferJob(job, 60 * 60 * 1000);
          return;
        }
        if (!(await passesActiveHoursGate())) {
          const human = await getHumanEngineScheduleConfig();
          await deferJob(job, msUntilNextActiveHour(human.active_hours ?? []));
          return;
        }
      }

      if (POSTING_JOBS.includes(type) && !(await passesWeekendVolumeGate())) {
        await deferJob(job, 2 * 60 * 60 * 1000);
        return;
      }

      if (accountId && POSTING_JOBS.includes(type)) {
        const waitMs = await checkMinPublishInterval(accountId, type);
        if (waitMs) {
          await deferJob(job, waitMs);
          return;
        }
      }

      const humanConfig = await getHumanEngineConfig();

      if (accountId && !acquireAccount(accountId)) {
        throw new Error('ACCOUNT_BUSY');
      }

      if (humaJobId) {
        await supabase.from('huma_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', humaJobId);
      }

      try {
        if (accountId) {
          if (type === 'cafe_new_post') await assertCafeNewPostAccount(accountId);
          if (type === 'cafe_reply') await assertCafeReplyAccount(accountId);

          const countField = dailyCountField(type);
          let limit = await getEffectiveDailyLimit(type);
          const scheduledCrank = Boolean(
            (payload as { scheduledCrank?: boolean }).scheduledCrank,
          );
          if (type === 'social_crank' || type === 'cafe_reply') {
            if (!scheduledCrank) {
              const ctx = await loadAccountForBrowser(accountId);
              const crankCap = getCrankDailyLimit(ctx.warmup_day ?? 0);
              limit = type === 'cafe_reply'
                ? Math.min(await getEffectiveDailyLimit('cafe_reply'), crankCap)
                : crankCap;
            } else if (type === 'social_crank') {
              limit = 999;
            }
          }
          if (!scheduledCrank && (await getTodayCount(accountId, countField)) >= limit) {
            throw new Error('DAILY_LIMIT');
          }
        }
        const workspace = payload.workspace as string | undefined;
        if (workspace) await checkSharedWorkspaceLimit(workspace, type);

        if (PLAYWRIGHT_JOBS.includes(type)) {
          let modemSession: ModemSession | undefined;
          if (accountId) modemSession = await acquireModem(accountId);

          const accountCtx = accountId
            ? await loadAccountForBrowser(accountId, modemSession?.proxyPort)
            : null;

          let rttScaleFactor = 1;
          if (accountCtx?.proxy_port) {
            const rtt = await measureRTT(accountCtx.proxy_port);
            rttScaleFactor = rttScale(rtt);
          }

          let context;
          if (accountCtx) {
            ({ context } = await createBrowserForAccount(accountCtx));
          } else {
            ({ context } = await createBrowser(modemSession?.proxyPort));
          }

          try {
            let resultUrl = '';

            if (type === 'post_blog') {
              const persona = parsePersona(accountCtx?.persona);
              const warmupPage = await context.newPage();
              await preSessionWarmup(warmupPage, persona, 'posting', humanConfig);
              await warmupPage.close();
              if (accountId) {
                await naverLogin(context, accountId, { profilePath: accountCtx?.profile_path });
              }
              const page = await context.newPage();
              ({ resultUrl } = await executePostBlog({
                page,
                payload,
                humanConfig,
                persona,
                rttScale: rttScaleFactor,
              }));
            } else {
              if (accountId) await naverLogin(context, accountId, { profilePath: accountCtx?.profile_path });
              const page = await context.newPage();
              if (type === 'cafe_new_post') {
                ({ resultUrl } = await executeCafePost({ page, payload, humanConfig }));
              } else if (type === 'cafe_reply') {
                ({ resultUrl } = await executeCafeReply({ page, payload, humanConfig }));
              }
            }

            if (humaJobId && resultUrl) await completeJob(humaJobId, resultUrl);
            if (accountId) await incrementAccountCount(accountId, dailyCountField(type));          } catch (err) {
            if (accountId && (isCaptchaError(err) || isBlockError(err))) {
              await handleLayer4Detection(accountId, err, modemSession);
            }
            throw err;
          } finally {
            await closeBrowserContext(context);
            if (modemSession) await releaseModem(modemSession);
          }
        } else if (type === 'social_crank') {
          const crankPayload = payload as {
            ourBlogUrls?: string[];
            scheduledCrank?: boolean;
          };
          if (crankPayload.scheduledCrank) {
            await executeScheduledSocialCrank(accountId!, {
              ourBlogUrls: crankPayload.ourBlogUrls ?? [],
              scheduledCrank: true,
            });
          } else {
            await executeSocialCrank(accountId!, {
              ourBlogUrls: crankPayload.ourBlogUrls ?? [],
            });
          }
        } else if (
          [
            'tiktok_upload',
            'instagram_reel',
            'instagram_post',
            'threads_post',
            'threads_reply',
            'twitter_post',
            'twitter_reply',
            'pinterest_upload',
          ].includes(type)
        ) {
          const platformPostId = await executeSocialPost(type, payload);
          if (humaJobId) await completeJob(humaJobId, platformPostId);
          if (humaJobId && platformPostId && (type === 'threads_post' || type === 'twitter_post')) {
            await activatePendingSocialReplies(humaJobId, platformPostId);
          }
        } else if (type === 'video_pipeline') {
          await executeVideoPipeline(payload.videoQueueId as string);
          if (humaJobId) await completeJob(humaJobId);
        } else if (type === 'content_full') {
          await executeContentFull(humaJobId!);
        }

        if (humaJobId && type === 'social_crank') await completeJob(humaJobId);

        await logOperation({ level: 'info', message: `작업 완료: ${type}`, job_id: humaJobId, account_id: accountId });
      } catch (err) {
        if (humaJobId && isSlimDataCapError(err)) {
          await scheduleSlimCapRetry(humaJobId, job.data as Record<string, unknown>);
          await logOperation({
            level: 'warn',
            message: `초알뜰 데이터 소진 — 자정 재시도: ${type}`,
            job_id: humaJobId,
            account_id: accountId,
          });
          return;
        }
        if (humaJobId) {          await supabase
            .from('huma_jobs')
            .update({ status: 'failed', error_message: (err as Error).message })
            .eq('id', humaJobId);
        }
        await logOperation({ level: 'ERROR', message: (err as Error).message, job_id: humaJobId, account_id: accountId });
        throw err;
      } finally {
        if (accountId) releaseAccount(accountId);
      }
    },
    { connection: redisConnection, concurrency }
  );
  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
