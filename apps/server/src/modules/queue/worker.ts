import { Worker, DelayedError } from 'bullmq';
import type { BrowserContext } from 'playwright';
import { redisConnection } from './producer.js';
import { supabase } from '../../middleware/auth.js';
import {
  createBrowserForAccount,
  closeBrowserContext,
  createBrowser,
  closeIdleBlankTabs,
  closeExtraTabsExcept,
  acquireWorkflowPage,
} from '../playwright/browser.js';
import { isPostBlogRetryableError, POST_BLOG_RETRY } from '../playwright/naver/blog-editor-pipeline.js';
import { pickPostingWorkflowPage } from '../../lib/posting-captcha-session.js';
import { sleep } from '../../lib/utils.js';
import { loadAccountForBrowser } from '../playwright/account-loader.js';
import { ensureNaverLoggedIn, naverLogin } from '../playwright/naver/login.js';
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
import { isScheduledPublishDue, resolveHumaJobScheduledAt } from '../../lib/job-scheduler.js';
import { pickNaverCaptchaPage, tryAutoSolveNaverCaptcha } from '../../lib/naver-captcha-vision.js';
import { isNaverLoginPagePendingSubmit } from '../../lib/posting-captcha-session.js';
import {
  isWarmupConnectionError,
  recoverPostingDongleAfterWarmupConnection,
} from '../../lib/warmup-dongle-recover.js';
import { ensurePostingDongleSocksReady } from '../../lib/ensure-posting-dongle-socks.js';
import { proxyPortToSlot } from '../../lib/modem-ports.js';
import { handleLayer4Detection, isBlockError, isCaptchaError, isNaverHumanHoldError } from '../watcher/detector.js';
import { enterCaptchaHold } from '../watcher/captcha-hold.js';
import { acquireModem, releaseModem, type ModemSession } from '../proxy/manager.js';
import { hasIdleCrankModem } from '../modem/allocation.js';
import { acquireAccount, releaseAccount } from '../../lib/account-lock.js';
import { getCrankDailyLimit } from '../playwright/warmup.js';
import { checkSharedWorkspaceLimit } from '../../lib/shared-limit.js';
import { assertAccountPostingQuota } from '../../lib/posting-daily-status.js';
import { checkCrossPostingStagger } from '../../lib/posting-cross-stagger.js';
import { logOperation } from '../../lib/log-emitter.js';
import {
  handleNaverAccountProtection,
  isNaverAccountProtectionError,
  parseNaverAccountProtectionPhase,
  throwIfNaverAccountProtectionInContext,
} from '../../lib/naver-account-protection.js';
import { executePostBlog } from './jobs/post-blog.js';
import { applyPostingResourceBlocking } from '../playwright/naver/posting-resource-block.js';
import { executeCafePost } from './jobs/cafe-post.js';
import { executeCafeReply } from './jobs/cafe-reply.js';
import { executeSocialCrank } from './jobs/social-crank.js';
import { executeScheduledSocialCrank } from '../crank/scheduled-session.js';
import { executeVideoPipeline } from './jobs/video-pipeline.js';
import { executeVideoContentConti } from './jobs/video-content-conti.js';
import { executeVideoContentRender } from './jobs/video-content-render.js';
import { executeVideoContentGenerate } from './jobs/video-content-generate.js';
import { executeContentFull } from '../claude/auto-content-orchestrator.js';
import { recordPublishedPost } from '../blog-check/post-record.js';
import { executeBlogCheckJob } from './jobs/blog-check.js';
import { executeSocialPost } from './jobs/social-post.js';
import { scheduleRepeatIfNeeded } from '../../lib/repeat-scheduler.js';
import { activatePendingSocialReplies } from '../../lib/social-reply-chain.js';
import { isSlimDataCapError, scheduleSlimCapRetry } from '../../lib/slim-retry.js';
import { assertCafeNewPostAccount, assertCafeReplyAccount } from '../../lib/cafe-accounts.js';
import { assertAccountRunnable, resolveHumaJobAdvanceRequested } from '../../lib/account-guards.js';
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
import { purgePostBlogStorageMedia } from '../../lib/cleanup-post-blog-storage.js';
import { finalizePostBlogJob } from '../../lib/post-blog-job-complete.js';
import { isPostingConnectionError } from '../../lib/posting-connection-error.js';
import { tryReconcilePostBlogJobCompletion } from '../../lib/post-blog-reconcile.js';

async function getTodayCount(accountId: string, field: 'post_count_today' | 'crank_count_today'): Promise<number> {
  const { data } = await supabase.from('huma_accounts').select(`${field}`).eq('id', accountId).single();
  if (!data) return 0;
  return (data as Record<string, number>)[field] ?? 0;
}

async function incrementAccountCount(accountId: string, field: 'post_count_today' | 'crank_count_today') {
  const current = await getTodayCount(accountId, field);
  await supabase
    .from('huma_accounts')
    .update({ [field]: current + 1 })
    .eq('id', accountId)
    .eq(field, current);
}

async function completeJob(jobId: string, resultUrl?: string) {
  const { data: job } = await supabase.from('huma_jobs').select('job_type').eq('id', jobId).single();
  if (job?.job_type === 'post_blog' && resultUrl?.trim()) {
    await finalizePostBlogJob(jobId, resultUrl);
    return;
  }

  const { data: fullJob } = await supabase.from('huma_jobs').select('*').eq('id', jobId).single();
  const published = Boolean(resultUrl?.trim());

  if (fullJob?.job_type === 'post_blog' && published) {
    await purgePostBlogStorageMedia(fullJob.image_urls as string[] | null, {
      jobId,
      accountId: fullJob.account_id as string | undefined,
    });
  }

  await supabase
    .from('huma_jobs')
    .update({
      status: 'completed',
      ...(resultUrl ? { result_url: resultUrl } : {}),
      completed_at: new Date().toISOString(),
      ...(fullJob?.job_type === 'post_blog' && published ? { image_urls: null } : {}),
    })
    .eq('id', jobId);

  if (fullJob?.job_type === 'post_blog' && published && resultUrl?.trim() && fullJob.account_id) {
    await recordPublishedPost({
      accountId: fullJob.account_id as string,
      resultUrl,
      title: fullJob.title as string | null,
      content: fullJob.content as string | null,
      linkUrl: fullJob.link_url as string | null,
      imageUrls: fullJob.image_urls as string[] | null,
      publishedAt: new Date().toISOString(),
      workspace: fullJob.workspace as string | null,
      hasVideo: fullJob.content_type === 'B',
    });
  }

  if (fullJob) await scheduleRepeatIfNeeded(fullJob as import('../../lib/job-scheduler.js').JobRecord);
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
      const { type, accountId, payload, humaJobId, advanceRequested: advanceFlag } = job.data as {
        type: string;
        accountId?: string;
        payload: Record<string, unknown>;
        humaJobId?: string;
        advanceRequested?: boolean;
      };

      const scheduledCrank = type === 'social_crank' && isScheduledCrankPayload(payload);
      const advanceRequested = await resolveHumaJobAdvanceRequested(humaJobId, {
        advanceRequested: advanceFlag,
      });
      const humaScheduledAt =
        type === 'post_blog' && humaJobId ? await resolveHumaJobScheduledAt(humaJobId) : null;
      const honorDueScheduledPublish =
        type === 'post_blog' && !advanceRequested && isScheduledPublishDue(humaScheduledAt);

      if (
        getSystemPaused() &&
        type !== 'blog_check' &&
        type !== 'video_content_generate' &&
        type !== 'video_content_conti' &&
        type !== 'video_content_render'
      ) {
        await deferHumaJob(job, humaJobId, CRANK_PAUSE_DEFER_MS, {
          reason: 'SYSTEM_PAUSED',
          accountId,
          token,
          logMessage: '[crank] 전체 정지 — 5분 후 재예약',
          level: 'info',
        });
        throw new DelayedError();
      }

      if (isCrankActivityJobType(type) && !getCrankEnabled() && !advanceRequested) {
        await deferHumaJob(job, humaJobId, CRANK_PAUSE_DEFER_MS, {
          reason: 'CRANK_ACTIVITY_DISABLED',
          accountId,
          token,
          logMessage: '[crank] 활동 OFF — 5분 후 재확인',
          level: 'info',
        });
        throw new DelayedError();
      }

      if (isPostingActivityJobType(type) && !getPostingEnabled() && !advanceRequested) {
        await deferHumaJob(job, humaJobId, CRANK_PAUSE_DEFER_MS, {
          reason: 'POSTING_ACTIVITY_DISABLED',
          accountId,
          token,
          logMessage: '[posting] 활동 OFF — 5분 후 재확인',
          level: 'info',
        });
        throw new DelayedError();
      }

      if (
        PLAYWRIGHT_AND_CRANK.includes(type) &&
        !scheduledCrank &&
        !advanceRequested &&
        !honorDueScheduledPublish
      ) {
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

      if (
        POSTING_JOBS.includes(type) &&
        type !== 'post_blog' &&
        !advanceRequested &&
        !(await passesWeekendVolumeGate())
      ) {
        await deferHumaJob(job, humaJobId, 2 * 60 * 60 * 1000, {
          reason: 'WEEKEND_VOLUME',
          accountId,
          token,
        });
        throw new DelayedError();
      }

      if (accountId && POSTING_JOBS.includes(type) && !advanceRequested && !honorDueScheduledPublish) {
        const waitMs = await checkMinPublishInterval(accountId, type);
        if (waitMs) {
          await deferHumaJob(job, humaJobId, waitMs, {
            accountId,
            token,
            reason: 'MIN_PUBLISH_INTERVAL',
            logMessage: `[${type}] 최소 발행 간격 — ${Math.ceil(waitMs / 60_000)}분 후 재예약`,
            level: 'info',
          });
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

      const skipAccountLock =
        type === 'video_content_conti' ||
        type === 'video_content_render' ||
        type === 'video_content_generate';

      if (accountId && !skipAccountLock && !(await acquireAccount(accountId))) {
        if (scheduledCrank || advanceRequested) {
          await deferHumaJob(job, humaJobId, advanceRequested ? 60_000 : CRANK_MODEM_DEFER_MS, {
            reason: 'ACCOUNT_BUSY',
            accountId,
            token,
            logMessage: advanceRequested
              ? `[${type}] 앞당기기 — 계정 사용 중 · 1분 후 재시도`
              : `[crank] 동글 대기 — 15분 후 재예약: ACCOUNT_BUSY`,
            level: 'info',
          });
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
            .eq('id', humaJobId)
            .neq('status', 'completed');
        }
      };

      let skipReleaseAccount = false;

      try {
        if (accountId) {
          if (type === 'cafe_new_post') await assertCafeNewPostAccount(accountId);
          if (type === 'cafe_reply') await assertCafeReplyAccount(accountId);

          if (!scheduledCrank && type !== 'post_blog') {
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
        if (accountId && workspace && type === 'post_blog' && !advanceRequested) {
          await assertAccountPostingQuota(workspace, accountId, {
            excludeJobId: humaJobId ?? undefined,
          });
        }
        if (type === 'post_blog' && accountId && !advanceRequested) {
          const crossWait = await checkCrossPostingStagger(accountId);
          if (crossWait) {
            await deferHumaJob(job, humaJobId, crossWait, {
              accountId,
              token,
              logMessage: `[post_blog] 동글 CAPTCHA 겹침 방지 — ${Math.ceil(crossWait / 60_000)}분 후`,
              level: 'info',
            });
            throw new DelayedError();
          }
        }
        if (workspace) await checkSharedWorkspaceLimit(workspace, type, accountId);

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

          if (type === 'post_blog' && modemSession?.proxyPort) {
            const socks = await ensurePostingDongleSocksReady(
              modemSession.proxyPort,
              modemSession.modemId || undefined,
              { context: 'post_blog' },
            );
            if (!socks.ok) {
              await deferHumaJob(job, humaJobId, 5 * 60_000, {
                reason: 'SOCKS_PROBE',
                accountId,
                token,
                logMessage: `[post_blog] ${socks.detail} — 5분 후 재시도`,
                level: 'warn',
              });
              if (modemSession) await releaseModem(modemSession).catch(() => {});
              throw new DelayedError();
            }
          }

          const accountCtx = accountId
            ? await loadAccountForBrowser(accountId, modemSession?.proxyPort)
            : null;

          let rttScaleFactor = 1;
          if (accountCtx?.proxy_port) {
            const rtt = await measureRTT(accountCtx.proxy_port);
            rttScaleFactor = rttScale(rtt);
          }

          let context: BrowserContext;
          if (accountCtx) {
            ({ context } = await createBrowserForAccount(accountCtx));
          } else {
            ({ context } = await createBrowser(modemSession?.proxyPort));
          }

          if (type === 'post_blog') {
            await applyPostingResourceBlocking(context).catch(() => {});
          }

          let heldForCaptcha = false;
          let runPostBlog: (() => Promise<string>) | null = null;

          try {
            let resultUrl = '';

            if (type === 'post_blog') {
              const persona = parsePersona(accountCtx?.persona);
              const platformSchedule = payload.platform_schedule as Record<string, unknown> | undefined;
              const resumeAfterCaptcha = platformSchedule?._resumeAfterCaptcha === true;

              if (!resumeAfterCaptcha) {
                const runPostingWarmup = async (ctx: BrowserContext) => {
                  const warmupPage = await acquireWorkflowPage(ctx);
                  try {
                    await preSessionWarmup(warmupPage, persona, 'posting', humanConfig);
                  } finally {
                    await closeExtraTabsExcept(ctx, warmupPage);
                  }
                };

                const deferWarmupConnection = async (detail: string) => {
                  await deferHumaJob(job, humaJobId, 5 * 60 * 1000, {
                    reason: 'WARMUP_CONNECTION',
                    accountId,
                    token,
                    logMessage: `[post_blog] ${detail} — 5분 후 재시도`,
                    level: 'info',
                  });
                  throw new DelayedError();
                };

                try {
                  await runPostingWarmup(context);
                } catch (warmupErr) {
                  if (isWarmupConnectionError(warmupErr) && modemSession && accountCtx) {
                    const slot = proxyPortToSlot(modemSession.proxyPort);
                    await logOperation({
                      level: 'warn',
                      message: `[post_blog] 워밍업 접속 실패(slot${slot}) — 동글 복구 시도`,
                      job_id: humaJobId,
                      account_id: accountId,
                      modem_id: modemSession.modemId || undefined,
                    });

                    await closeBrowserContext(context);

                    const recover = await recoverPostingDongleAfterWarmupConnection(
                      modemSession.proxyPort,
                      modemSession.modemId,
                    );

                    await logOperation({
                      level: recover.ok ? 'info' : 'ERROR',
                      message: `[post_blog] 동글 복구 ${recover.ok ? '성공' : '실패'} (${recover.method}: ${recover.detail})`,
                      job_id: humaJobId,
                      account_id: accountId,
                      modem_id: modemSession.modemId || undefined,
                    });

                    if (!recover.ok) {
                      await deferWarmupConnection('동글 복구 실패');
                    }

                    ({ context } = await createBrowserForAccount(accountCtx));
                    await applyPostingResourceBlocking(context).catch(() => {});
                    try {
                      await runPostingWarmup(context);
                    } catch (retryErr) {
                      if (isWarmupConnectionError(retryErr)) {
                        await deferWarmupConnection('동글 복구 후 워밍업 재시도 실패');
                      }
                      throw retryErr;
                    }
                  } else {
                    throw warmupErr;
                  }
                }
              }

              await markRunning();

              const captchaCtx = {
                humaJobId,
                accountId,
                workspace: jobWorkspace,
                jobType: type,
              };

              runPostBlog = async (): Promise<string> => {
                await closeIdleBlankTabs(context);
                let lastErr: Error | undefined;
                for (let attempt = 1; attempt <= 4; attempt += 1) {
                  const page = pickPostingWorkflowPage(context) ?? (await acquireWorkflowPage(context));
                  try {
                    const out = await executePostBlog({
                      page,
                      payload,
                      humanConfig,
                      persona,
                      rttScale: rttScaleFactor,
                      accountId,
                    });
                    return out.resultUrl;
                  } catch (postErr) {
                    lastErr = postErr as Error;
                    const msg = lastErr.message ?? '';
                    if (attempt < POST_BLOG_RETRY.maxAttempts && isPostBlogRetryableError(msg)) {
                      await sleep(POST_BLOG_RETRY.delayMs);
                      continue;
                    }
                    throw postErr;
                  }
                }
                throw lastErr ?? new Error('BLOG_EDITOR_NOT_READY');
              };

              if (accountId) {
                if (resumeAfterCaptcha) {
                  await ensureNaverLoggedIn(context, accountId, {
                    profilePath: accountCtx?.profile_path,
                    fastCheck: true,
                    keepSessionPage: true,
                  });
                } else {
                  await naverLogin(context, accountId, {
                    profilePath: accountCtx?.profile_path,
                    captchaContext: captchaCtx,
                    keepSessionPage: true,
                  });
                }
              }

              resultUrl = await runPostBlog!();
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
            if (accountId && isNaverAccountProtectionError(err)) {
              throw err;
            }
            if (
              humaJobId &&
              accountId &&
              isNaverHumanHoldError(err) &&
              POSTING_JOBS.includes(type)
            ) {
              let visionAutoFailed = false;
              const captchaPage = await pickNaverCaptchaPage(context);
              const errMsg = (err as Error).message ?? '';
              const shouldRetryVision =
                isCaptchaError(err) ||
                (Boolean(captchaPage) && errMsg.includes('HUMAN_CLICK_NO_BBOX'));
              if (shouldRetryVision && captchaPage) {
                const vision = await tryAutoSolveNaverCaptcha(captchaPage, {
                  humaJobId,
                  accountId,
                  workspace: jobWorkspace,
                  jobType: type,
                });
                if (vision === 'solved') {
                  await throwIfNaverAccountProtectionInContext(context, 'captcha');
                  const pendingLogin = await isNaverLoginPagePendingSubmit(captchaPage);
                  if (!pendingLogin) {
                  try {
                    let retryResultUrl = '';
                    if (type === 'post_blog' && runPostBlog) {
                      retryResultUrl = await runPostBlog();
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
                }
                if (vision === 'failed') visionAutoFailed = true;
              } else if (errMsg.includes('HUMAN_CLICK_NO_BBOX') && captchaPage) {
                visionAutoFailed = true;
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
                payload: type === 'post_blog' ? payload : undefined,
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
              await closeBrowserContext(context).catch(() => {});
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
        } else if (type === 'video_content_conti') {
          await markRunning();
          await executeVideoContentConti(payload.accountId as string);
        } else if (type === 'video_content_render') {
          await markRunning();
          await executeVideoContentRender(payload.historyId as string);
        } else if (type === 'video_content_generate') {
          await markRunning();
          await executeVideoContentGenerate(payload as { accountId: string; historyId?: string });
        } else if (type === 'content_full') {
          await markRunning();
          await executeContentFull(humaJobId!);
        } else if (type === 'blog_check') {
          const bcPayload = (payload ?? {}) as {
            accountId?: string | null;
            blogId?: string | null;
            mode?: string | null;
            postNos?: string[] | null;
            autoScheduled?: boolean;
          };
          const result = await executeBlogCheckJob(bcPayload);
          const postNos = bcPayload.postNos?.filter(Boolean) ?? [];
          const skipped = 'skippedAlreadyScanned' in result && result.skippedAlreadyScanned;
          await logOperation({
            level: skipped ? 'info' : postNos.length > 0 && result.scannedPosts === 0 ? 'warn' : 'info',
            message: skipped
              ? `[blog-check] 자동 스캔 생략 — 이미 스캔됨 (postNos=${postNos.join(',')})`
              : `[blog-check] 스캔 완료 — 계정 ${result.scannedAccounts} · 포스트 ${result.scannedPosts}${postNos.length ? ` (요청 postNos=${postNos.join(',')})` : ''}${bcPayload.autoScheduled ? ' [자동]' : ''}`,
            account_id: bcPayload.accountId ?? accountId,
          });
        }

        if (humaJobId && type === 'social_crank') await completeJob(humaJobId);

        await logOperation({ level: 'info', message: `작업 완료: ${type}`, job_id: humaJobId, account_id: accountId });
      } catch (err) {
        if (accountId && isNaverAccountProtectionError(err)) {
          const jobWorkspace = (payload.workspace as string | undefined) ?? undefined;
          await handleNaverAccountProtection({
            accountId,
            workspace: jobWorkspace,
            phase: parseNaverAccountProtectionPhase(err),
            humaJobId,
          }).catch((handlerErr) => {
            console.error('[naver] protection handler:', (handlerErr as Error).message);
          });
          return;
        }
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
        const isVideoContentJob =
          type === 'video_content_conti' ||
          type === 'video_content_render' ||
          type === 'video_content_generate';
        if (humaJobId && type === 'post_blog') {
          const msg = (err as Error).message ?? '';
          const reconciledUrl = await tryReconcilePostBlogJobCompletion(humaJobId).catch(() => null);
          if (reconciledUrl) {
            if (accountId) await incrementAccountCount(accountId, dailyCountField(type));
            await logOperation({
              level: 'info',
              message: `[post_blog] 네이버 발행 확인 — 오류 무시·완료 처리 (${reconciledUrl})`,
              job_id: humaJobId,
              account_id: accountId,
            });
            return;
          }
          if (!advanceRequested && isPostingConnectionError(msg)) {
            await deferHumaJob(job, humaJobId, 5 * 60 * 1000, {
              reason: 'PROXY_CONNECTION',
              accountId,
              token,
              logMessage: `[post_blog] 동글/프록시 연결 실패 — 5분 후 재시도`,
              level: 'warn',
            });
            throw new DelayedError();
          }
        }
        if (humaJobId) {
          await supabase
            .from('huma_jobs')
            .update({ status: 'failed', error_message: (err as Error).message, started_at: null })
            .eq('id', humaJobId)
            .neq('status', 'completed');
        }
        if (!isVideoContentJob) {
          await logOperation({
            level: 'ERROR',
            message: (err as Error).message,
            job_id: humaJobId,
            account_id: accountId,
          });
        }
        throw err;
      } finally {
        if (accountId && !skipReleaseAccount && !skipAccountLock) await releaseAccount(accountId);
      }
    },
    { connection: redisConnection, concurrency }
  );
  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
