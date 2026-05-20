import { Worker } from 'bullmq';
import { redisConnection } from './producer.js';
import { supabase } from '../../middleware/auth.js';
import { createBrowser } from '../playwright/browser.js';
import { naverLogin } from '../playwright/naver/login.js';
import { getHumanEngineConfig, isNightBan } from '../../lib/settings.js';
import { handleLayer4Detection, isCaptchaError, isBlockError } from '../watcher/detector.js';
import { acquireModem, releaseModem } from '../proxy/manager.js';
import { acquireAccount, releaseAccount } from '../../lib/account-lock.js';
import { getDailyLimit } from '../../lib/limits.js';
import { checkSharedWorkspaceLimit } from '../../lib/shared-limit.js';
import { logOperation } from '../../lib/log-emitter.js';
import { executePostBlog } from './jobs/post-blog.js';
import { executeCafePost } from './jobs/cafe-post.js';
import { executeCafeReply } from './jobs/cafe-reply.js';
import { executeSocialCrank } from './jobs/social-crank.js';
import { executeVideoPipeline } from './jobs/video-pipeline.js';
import { executeSocialPost } from './jobs/social-post.js';

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

async function saveJobResult(jobId: string, resultUrl: string) {
  await supabase
    .from('huma_jobs')
    .update({ status: 'completed', result_url: resultUrl, completed_at: new Date().toISOString() })
    .eq('id', jobId);
}

const PLAYWRIGHT_JOBS = ['post_blog', 'cafe_new_post', 'cafe_reply'];

export function startWorker() {
  const worker = new Worker(
    'huma-jobs',
    async (job) => {
      if (systemPaused) throw new Error('SYSTEM_PAUSED');

      const { type, accountId, payload, humaJobId } = job.data as {
        type: string;
        accountId?: string;
        payload: Record<string, unknown>;
        humaJobId?: string;
      };

      const humanConfig = await getHumanEngineConfig();
      if (PLAYWRIGHT_JOBS.includes(type) || type === 'social_crank') {
        if (isNightBan(humanConfig)) throw new Error('NIGHT_BAN');
      }

      if (accountId && !acquireAccount(accountId)) {
        throw new Error('ACCOUNT_BUSY');
      }

      if (humaJobId) {
        await supabase.from('huma_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', humaJobId);
      }

      try {
        if (accountId) {
          const countField = type === 'social_crank' ? 'crank_count_today' : 'post_count_today';
          const limit = getDailyLimit(type);
          if ((await getTodayCount(accountId, countField)) >= limit) throw new Error('DAILY_LIMIT');
        }

        const workspace = payload.workspace as string | undefined;
        if (workspace) await checkSharedWorkspaceLimit(workspace, type);

        if (PLAYWRIGHT_JOBS.includes(type)) {
          let proxyPort: number | undefined;
          if (accountId) proxyPort = await acquireModem(accountId);

          const { browser, context } = await createBrowser(proxyPort);
          try {
            if (accountId) await naverLogin(context, accountId);
            const page = await context.newPage();
            let resultUrl = '';

            if (type === 'post_blog') {
              ({ resultUrl } = await executePostBlog({ page, payload, humanConfig }));
            } else if (type === 'cafe_new_post') {
              ({ resultUrl } = await executeCafePost({ page, payload, humanConfig }));
            } else if (type === 'cafe_reply') {
              ({ resultUrl } = await executeCafeReply({ page, payload, humanConfig }));
            }

            if (humaJobId && resultUrl) await saveJobResult(humaJobId, resultUrl);
            if (accountId) await incrementAccountCount(accountId, 'post_count_today');
          } catch (err) {
            if (accountId && (isCaptchaError(err) || isBlockError(err))) {
              await handleLayer4Detection(accountId);
            }
            throw err;
          } finally {
            await browser.close();
            if (proxyPort) releaseModem(proxyPort);
          }
        } else if (type === 'social_crank') {
          await executeSocialCrank(accountId!, payload as { ourBlogUrls: string[] });
          if (accountId) await incrementAccountCount(accountId, 'crank_count_today');
        } else if (type === 'video_pipeline') {
          await executeVideoPipeline(payload.videoQueueId as string);
        } else if (['tiktok_upload', 'instagram_reel', 'instagram_post', 'threads_post', 'twitter_post'].includes(type)) {
          await executeSocialPost(type, payload);
        }

        await logOperation({ level: 'info', message: `작업 완료: ${type}`, job_id: humaJobId, account_id: accountId });
      } catch (err) {
        if (humaJobId) {
          await supabase
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
    { connection: redisConnection, concurrency: 5 }
  );

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
