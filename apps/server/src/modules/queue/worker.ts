import { Worker, DelayedError } from 'bullmq';
import { redisConnection } from './producer.js';
import { supabase } from '../../middleware/auth.js';
import {
  createBrowserForAccount,
  closeBrowserContext,
  createBrowser,
  releaseWorkflowPage,
  closeIdleBlankTabs,
  acquireWorkflowPage,
} from '../playwright/browser.js';
import { loadAccountForBrowser } from '../playwright/account-loader.js';
import { naverLogin, ensureNaverLoggedIn } from '../playwright/naver/login.js';
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
import { pickNaverCaptchaPage, tryAutoSolveNaverCaptcha } from '../../lib/naver-captcha-vision.js';
import { clickNaverLoginButton } from '../../lib/naver-login-fields.js';
import { handleLayer4Detection, isCaptchaError, isBlockError } from '../watcher/detector.js';
import { enterCaptchaHold } from '../watcher/captcha-hold.js';
import { acquireModem, releaseModem, type ModemSession } from '../proxy/manager.js';
import { hasIdleCrankModem } from '../modem/allocation.js';
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
import { assertAccountRunnable, isHumaJobAdvanceRequested } from '../../lib/account-guards.js';
import { getSystemPaused } from '../../lib/system-pause.js';
import {
  getCrankEnabled,
  getPostingEnabled,
  isCrankActivityJobType,
  isPostingActivityJobType,
} from '../../lib/activity-control.js';
import { isCrankCaptchaHoldSignal } from '../../lib/crank-captcha-hold.js';
import {
  CRANK_MODEM_DEFER_MS,
  CRANK_NIGHT_DEFER_MS,
  CRANK_PAUSE_DEFER_MS,
  deferHumaJob,
  isCrankModemDeferError,
  isRetryableCrankError,
  isScheduledCrankPayload,
} from '../../lib/crank-worker-defer.js';

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

async function deferCrankForIdleModem(
  job: { moveToDelayed: (ts: number, token?: string) => Promise<void> },
  token: string | undefined,
  humaJobId: string | undefined,
  accountId: string | undefined,
  reason?: string,
): Promise<void> {
  await deferHumaJob(job, humaJobId, CRANK_MODEM_DEFER_MS, {
    reason: reason ?? null,
    accountId,
    token,
    logMessage: `[crank] 동글 대기 — 15분 후 재예약${reason ? `: ${reason}` : ''}`,
  });
}

export function startWorker(concurrency = Number(process.env.HUMA_WORKER_CONCURRENCY) || 5) {
  const worker = new Worker(
    'huma-jobs',
    async (job, token) => {
      const { type, accountId, payload, humaJobId } = job.data as {
        type: string;
        accountId?: string;
        payload: Record<string, unknown>;
        humaJobId?: string;
      };

      const scheduledCrank = type === 'social_crank' && isScheduledCrankPayload(payload);
      const advanceRequested = await isHumaJobAdvanceRequested(humaJobId);

      if (getSystemPaused()) {
        await deferHumaJob(job, humaJobId, CRANK_PAUSE_DEFER_MS, {
          reason: 'SYSTEM_PAUSED',
          accountId,
          token,
          logMessage: '[crank] 전체 정지 — 5분 후 재예약',
          level: 'info',
        });
        throw new DelayedError();
      }

      if (isCrankActivityJobType(type) && !getCrankEnabled()) {
        await deferHumaJob(job, humaJobId, CRANK_PAUSE_DEFER_MS, {
          reason: 'CRANK_ACTIVITY_DISABLED',
          accountId,
          token,
          logMessage: '[crank] 활동 OFF — 5분 후 재확인',
          level: 'info',
        });
        throw new DelayedError();
      }

      if (isPostingActivityJobType(type) && !getPostingEnabled()) {
        await deferHumaJob(job, humaJobId, CRANK_PAUSE_DEFER_MS, {
          reason: 'POSTING_ACTIVITY_DISABLED',
          accountId,
          token,
          logMessage: '[posting] 활동 OFF — 5분 후 재확인',
          level: 'info',
        });
        throw new DelayedError();
      }

      if (PLAYWRIGHT_AND_CRANK.includes(type) && !scheduledCrank && !advanceRequested) {
        if (await isNightBanActive()) {
          await deferHumaJob(job, humaJobId, CRANK_NIGHT_DEFER_MS, {
            reason: 'NIGHT_BAN',
            accountId,
            token,
            logMessage: `[${type}] 야간 금지 — 1시간 후 재예약`,
          });
          throw new DelayedError();
        }
        if (!(await passesActiveHoursGate())) {
          const human = await getHumanEngineScheduleConfig();
          await deferHumaJob(job, humaJobId, msUntilNextActiveHour(human.active_hours ?? []), {
            reason: 'ACTIVE_HOURS_BLOCKED',
            accountId,
            token,
            logMessage: `[${type}] 비활성 시간대 — 다음 활성 시간 재예약`,
          });
          throw new DelayedError();
        }
      }

      if (scheduledCrank && (await isNightBanActive())) {
        await deferHumaJob(job, humaJobId, CRANK_NIGHT_DEFER_MS, {
          reason: 'NIGHT_BAN',
          accountId,
          token,
          logMessage: '[crank] 야간 금지 — 1시간 후 재예약',
        });
        throw new DelayedError();
      }

      if (POSTING_JOBS.includes(type) && !(await passesWeekendVolumeGate())) {
        await deferHumaJob(job, humaJobId, 2 * 60 * 60 * 1000, {
          reason: 'WEEKEND_VOLUME',
          accountId,
          token,
        });
        throw new DelayedError();
      }

      if (accountId && POSTING_JOBS.includes(type)) {
        const waitMs = await checkMinPublishInterval(accountId, type);
        if (waitMs) {
          await deferHumaJob(job, humaJobId, waitMs, { accountId, token });
          throw new DelayedError();
        }
      }

      if (type === 'social_crank' && !(await hasIdleCrankModem())) {
        await deferCrankForIdleModem(job, token, humaJobId, accountId, '유휴 동글 없음');
        throw new DelayedError();
      }

      if (accountId && type === 'social_crank') {
        try {
          await assertAccountRunnable(accountId);
        } catch (err) {
          const msg = (err as Error).message;
          if (scheduledCrank && (msg === 'LAYER4_REST' || msg === 'ACCOUNT_INACTIVE')) {
            if (humaJobId) {
              await supabase
                .from('huma_jobs')
                .update({ status: 'failed', error_message: msg, started_at: null })
                .eq('id', humaJobId);
            }
            await logOperation({
              level: 'ERROR',
              message: `[crank] 스케줄 skip: ${msg}`,
              job_id: humaJobId,
              account_id: accountId,
            });
            return;
          }
          throw err;
        }
      }

      const humanConfig = await getHumanEngineConfig();

      if (accountId && !(await acquireAccount(accountId))) {
        if (scheduledCrank) {
          await deferCrankForIdleModem(job, token, humaJobId, accountId, 'ACCOUNT_BUSY');
          throw new DelayedError();
        }
        throw new Error('ACCOUNT_BUSY');
      }

      const markRunning = async () => {
        if (humaJobId) {
          await supabase
            .from('huma_jobs')
            .update({
              status: 'running',
              started_at: new Date().toISOString(),
              error_message: null,
              advance_requested_at: null,
            })
            .eq('id', humaJobId);
        }
      };

      let skipReleaseAccount = false;

      try {
        if (accountId) {
          if (type === 'cafe_new_post') await assertCafeNewPostAccount(accountId);
          if (type === 'cafe_reply') await assertCafeReplyAccount(accountId);

          if (!scheduledCrank) {
            const countField = dailyCountField(type);
            let limit = await getEffectiveDailyLimit(type);
            if (type === 'social_crank' || type === 'cafe_reply') {
              const ctx = await loadAccountForBrowser(accountId);
              const crankCap = getCrankDailyLimit(ctx.warmup_day ?? 0);
              limit =
                type === 'cafe_reply'
                  ? Math.min(await getEffectiveDailyLimit('cafe_reply'), crankCap)
                  : crankCap;
            }
            if ((await getTodayCount(accountId, countField)) >= limit) {
              throw new Error('DAILY_LIMIT');
            }
          }
        }
        const workspace = payload.workspace as string | undefined;
        if (workspace) await checkSharedWorkspaceLimit(workspace, type);

        let jobWorkspace = workspace;
        if (!jobWorkspace && humaJobId) {
          const { data: jobRow } = await supabase
            .from('huma_jobs')
            .select('workspace, title')
            .eq('id', humaJobId)
            .maybeSingle();
          jobWorkspace = jobRow?.workspace ?? undefined;
        }

        if (PLAYWRIGHT_JOBS.includes(type)) {
          const deferMarkRunning = type === 'post_blog';
          if (!deferMarkRunning) await markRunning();
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

          let heldForCaptcha = false;

          try {
            let resultUrl = '';

            if (type === 'post_blog') {
              const persona = parsePersona(accountCtx?.persona);
              const platformSchedule = payload.platform_schedule as Record<string, unknown> | undefined;
              const resumeAfterCaptcha = platformSchedule?._resumeAfterCaptcha === true;

              if (!resumeAfterCaptcha) {
                const warmupPage = await acquireWorkflowPage(context);
                await preSessionWarmup(warmupPage, persona, 'posting', humanConfig);
                await releaseWorkflowPage(context, warmupPage);
              }

              if (accountId) {
                if (resumeAfterCaptcha) {
                  await ensureNaverLoggedIn(context, accountId, {
                    profilePath: accountCtx?.profile_path,
                    fastCheck: true,
                  });
                } else {
                  await naverLogin(context, accountId, {
                    profilePath: accountCtx?.profile_path,
                    captchaContext: {
                      humaJobId,
                      accountId,
                      workspace: jobWorkspace,
                      jobType: type,
                    },
                  });
                }
              }

              await markRunning();
              await closeIdleBlankTabs(context);
              const page = await acquireWorkflowPage(context);
              ({ resultUrl } = await executePostBlog({
                page,
                payload,
                humanConfig,
                persona,
                rttScale: rttScaleFactor,
              }));
            } else {
              if (accountId) {
                await naverLogin(context, accountId, {
                  profilePath: accountCtx?.profile_path,
                  captchaContext: {
                    humaJobId,
                    accountId,
                    workspace: jobWorkspace,
                    jobType: type,
                  },
                });
              }
              const page = await context.newPage();
              if (type === 'cafe_new_post') {
                ({ resultUrl } = await executeCafePost({ page, payload, humanConfig }));
              } else if (type === 'cafe_reply') {
                ({ resultUrl } = await executeCafeReply({ page, payload, humanConfig }));
              }
            }

            if (humaJobId && resultUrl) await completeJob(humaJobId, resultUrl);
            if (accountId && !heldForCaptcha) await incrementAccountCount(accountId, dailyCountField(type));
          } catch (err) {
            if (
              humaJobId &&
              accountId &&
              isCaptchaError(err) &&
              POSTING_JOBS.includes(type)
            ) {
              let visionAutoFailed = false;
              const captchaPage = pickNaverCaptchaPage(context);
              if (captchaPage) {
                const vision = await tryAutoSolveNaverCaptcha(captchaPage, {
                  humaJobId,
                  accountId,
                  workspace: jobWorkspace,
                  jobType: type,
                  resubmit: async () => {
                    if (captchaPage.url().includes('nidlogin')) await clickNaverLoginButton(captchaPage);
                  },
                });
                if (vision === 'solved') {
                  try {
                    let retryResultUrl = '';
                    if (type === 'post_blog') {
                      if (accountCtx) {
                        await ensureNaverLoggedIn(context, accountId, {
                          profilePath: accountCtx.profile_path,
                        });
                      }
                      await closeIdleBlankTabs(context);
                      const retryPage = await acquireWorkflowPage(context);
                      ({ resultUrl: retryResultUrl } = await executePostBlog({
                        page: retryPage,
                        payload,
                        humanConfig,
                        persona: parsePersona(accountCtx?.persona),
                        rttScale: rttScaleFactor,
                      }));
                    } else if (type === 'cafe_new_post') {
                      const retryPage = await context.newPage();
                      ({ resultUrl: retryResultUrl } = await executeCafePost({
                        page: retryPage,
                        payload,
                        humanConfig,
                      }));
                    } else if (type === 'cafe_reply') {
                      const retryPage = await context.newPage();
                      ({ resultUrl: retryResultUrl } = await executeCafeReply({
                        page: retryPage,
                        payload,
                        humanConfig,
                      }));
                    }
                    if (retryResultUrl) {
                      await completeJob(humaJobId, retryResultUrl);
                      await incrementAccountCount(accountId, dailyCountField(type));
                      return;
                    }
                  } catch {
                    /* Vision 후 재시도 실패 → VNC hold */
                  }
                }
                if (vision === 'failed') visionAutoFailed = true;
              }

              await handleLayer4Detection(accountId, err, modemSession, {
                skipExternalNotify: true,
                workspace: jobWorkspace,
                skipAccountPause: true,
              });
              await enterCaptchaHold({
                jobId: humaJobId,
                accountId,
                workspace: jobWorkspace,
                jobTitle: (payload.title as string | undefined) ?? type,
                jobType: type,
                context,
                modemSession,
                releaseAccountLock: () => releaseAccount(accountId),
                visionAutoFailed,
              });
              heldForCaptcha = true;
              skipReleaseAccount = true;
              return;
            }

            if (accountId && (isCaptchaError(err) || isBlockError(err))) {
              await handleLayer4Detection(accountId, err, modemSession, {
                workspace: jobWorkspace,
              });
            }
            throw err;
          } finally {
            if (!heldForCaptcha) {
              await closeBrowserContext(context);
              if (modemSession) await releaseModem(modemSession);
            }
          }
        } else if (type === 'social_crank') {
          const crankPayload = payload as {
            ourBlogUrls?: string[];
            scheduledCrank?: boolean;
            crankTrack?: number;
            preferredProxyPort?: number;
            resumeAfterCaptcha?: boolean;
          };
          await markRunning();
          const crankHoldOpts =
            humaJobId && accountId
              ? {
                  humaJobId,
                  releaseAccountLock: () => releaseAccount(accountId),
                }
              : undefined;

          if (crankPayload.scheduledCrank) {
            await executeScheduledSocialCrank(
              accountId!,
              {
                ourBlogUrls: crankPayload.ourBlogUrls ?? [],
                scheduledCrank: true,
                crankTrack: crankPayload.crankTrack,
                preferredProxyPort: crankPayload.preferredProxyPort,
              },
              crankHoldOpts,
            );
          } else {
            await executeSocialCrank(
              accountId!,
              {
                ourBlogUrls: crankPayload.ourBlogUrls ?? [],
                resumeAfterCaptcha: crankPayload.resumeAfterCaptcha,
              },
              crankHoldOpts,
            );
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
          await markRunning();
          const platformPostId = await executeSocialPost(type, payload);
          if (humaJobId) await completeJob(humaJobId, platformPostId);
          if (humaJobId && platformPostId && (type === 'threads_post' || type === 'twitter_post')) {
            await activatePendingSocialReplies(humaJobId, platformPostId);
          }
        } else if (type === 'video_pipeline') {
          await markRunning();
          await executeVideoPipeline(payload.videoQueueId as string);
          if (humaJobId) await completeJob(humaJobId);
        } else if (type === 'content_full') {
          await markRunning();
          await executeContentFull(humaJobId!);
        }

        if (humaJobId && type === 'social_crank') await completeJob(humaJobId);

        await logOperation({ level: 'info', message: `작업 완료: ${type}`, job_id: humaJobId, account_id: accountId });
      } catch (err) {
        if (type === 'social_crank' && isCrankCaptchaHoldSignal(err)) {
          skipReleaseAccount = true;
          return;
        }
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
        if (
          humaJobId &&
          type === 'social_crank' &&
          (isCrankModemDeferError((err as Error).message) ||
            (scheduledCrank && isRetryableCrankError((err as Error).message)))
        ) {
          await deferCrankForIdleModem(job, token, humaJobId, accountId, (err as Error).message);
          throw new DelayedError();
        }
        if (humaJobId) {
          await supabase
            .from('huma_jobs')
            .update({ status: 'failed', error_message: (err as Error).message, started_at: null })
            .eq('id', humaJobId);
        }
        await logOperation({ level: 'ERROR', message: (err as Error).message, job_id: humaJobId, account_id: accountId });
        throw err;
      } finally {
        if (accountId && !skipReleaseAccount) await releaseAccount(accountId);
      }
    },
    { connection: redisConnection, concurrency }
  );
  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
