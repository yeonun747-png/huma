import type { FastifyInstance } from 'fastify';
import { isVideoContentOperationalLog } from '@huma/shared';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import {
  enqueueHumaJob,
  removeBullJob,
  resolveJobStatus,
  buildEnqueuePayload,
  type JobRecord,
} from '../lib/job-scheduler.js';
import { enqueueJob } from '../modules/queue/producer.js';
import {
  registerAutoContentJobs,
  resolveAutoContentStartAt,
} from '../modules/claude/auto-content-orchestrator.js';
import { runContentPreview } from '../modules/claude/content-preview.js';
import {
  fetchAutoPublishStatus,
  fetchAutoPublishAccountsStatus,
  toggleAutoPublish,
} from '../modules/content/auto-publish.js';
import { promoteDryRunToPublish } from '../modules/queue/jobs/content-orchestrator.js';
import { kstTodayStartIso } from '../lib/posting-daily-status.js';
import { assertCafeNewPostAccount, assertCafeReplyAccount } from '../lib/cafe-accounts.js';
import { assertHumaJobAdvanceAllowed, assertHumaJobRunnable } from '../lib/account-guards.js';
import { assertManualSocialCrankAllowed } from '../lib/crank-guard.js';
import { getCrankJobSessionDetail } from '../lib/crank-job-session.js';
import { deleteJobById, deleteJobsByIds } from '../lib/delete-job.js';
import { abortHumaJobById } from '../lib/abort-job.js';
import { downloadHumaMedia, parseHumaMediaStoragePath } from '../lib/huma-media-storage.js';
import { resolveJobPreviewImageUrl } from '../lib/resolve-job-preview-image.js';
import { normalizeUploadedImagesInput, persistSingleJobImageDataUrl } from '../lib/upload-job-images.js';
import { readCaptchaHoldScreenshot } from '../lib/captcha-hold-screenshot.js';
import { submitCaptchaAnswerForJob } from '../lib/captcha-answer-submit.js';
import { reconcilePostBlogJobById } from '../lib/post-blog-reconcile.js';
import { revertPostBlogCompletion } from '../lib/revert-post-blog-completion.js';
import { explainPostBlogPublishDay } from '../lib/post-blog-publish-day.js';
import { diagnoseAutoPublishWorkspace } from '../lib/auto-publish-diagnosis.js';
import {
  completeCaptchaHold,
  getCaptchaHold,
  getCaptchaHoldPublicInfo,
} from '../modules/watcher/captcha-hold.js';
import { resolveVncUrl, buildJobWebUrl } from '../modules/watcher/telegram.js';
import {
  computeVisibleQueueStats,
  countContentFullPipelineShells,
  filterOutPipelineShells,
} from '../lib/job-pipeline-shell.js';
import { attachPostingAccountLabels, pickPostingAccount } from '../lib/posting-accounts.js';

const JOB_ACCOUNT_SELECT = '*, huma_accounts(name, slot_label)';

async function assertJobWorkspaceAccess(
  jobId: string,
  allowedWorkspaces: string[],
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: job } = await supabase.from('huma_jobs').select('workspace').eq('id', jobId).maybeSingle();
  if (!job) return { ok: false, status: 404, error: '작업 없음' };
  if (job.workspace && !allowedWorkspaces.includes(job.workspace)) {
    return { ok: false, status: 403, error: '워크스페이스 접근 권한 없음' };
  }
  return { ok: true };
}

function postingQuotaErrorStatus(message: string): number {
  if (
    message.includes('한도') ||
    message.includes('목표') ||
    message.includes('파이프라인') ||
    message.includes('OFF') ||
    message.includes('야간') ||
    message.includes('캐시') ||
    message.includes('계정')
  ) {
    return 429;
  }
  return 500;
}

async function fetchQueueStats(workspace: string) {
  const todayStart = kstTodayStartIso();
  const base = () => supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).eq('workspace', workspace);
  const [pendingRes, runningRes, captchaRes, visibleCompleted] = await Promise.all([
    base().in('status', ['pending', 'scheduled']),
    base().eq('status', 'running'),
    base().eq('status', 'awaiting_captcha'),
    computeVisibleQueueStats(workspace, todayStart),
  ]);
  return {
    pending: pendingRes.count ?? 0,
    running: (runningRes.count ?? 0) + (captchaRes.count ?? 0),
    doneToday: visibleCompleted.doneToday,
    doneAll: visibleCompleted.doneAll,
  };
}

export async function registerJobRoutes(app: FastifyInstance) {
  app.get('/api/jobs', { preHandler: authMiddleware }, async (request) => {
    const allowedWorkspaces = getWorkspaceFilter(request);
    const { status, workspace, platform, job_type, limit = '50' } = request.query as {
      status?: string;
      workspace?: string;
      platform?: string;
      job_type?: string;
      limit?: string;
    };

    let query = supabase
      .from('huma_jobs')
      .select(JOB_ACCOUNT_SELECT)
      .in('workspace', allowedWorkspaces)
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (status) query = query.eq('status', status);
    if (workspace && allowedWorkspaces.includes(workspace)) query = query.eq('workspace', workspace);
    if (platform) query = query.eq('platform', platform);
    if (job_type) query = query.eq('job_type', job_type);

    const { data, error } = await query;
    if (error) return [];
    return attachPostingAccountLabels(data ?? []);
  });

  app.get('/api/jobs/page', { preHandler: authMiddleware }, async (request, reply) => {
    const allowedWorkspaces = getWorkspaceFilter(request);
    const { workspace, limit = '20', offset = '0' } = request.query as {
      workspace?: string;
      limit?: string;
      offset?: string;
    };
    if (!workspace || !allowedWorkspaces.includes(workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    const take = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = Math.max(0, Number(offset) || 0);
    const from = skip;
    const to = skip + take - 1;

    const [{ data: liveJobs }, { data, error, count }] = await Promise.all([
      supabase
        .from('huma_jobs')
        .select(JOB_ACCOUNT_SELECT)
        .eq('workspace', workspace)
        .in('status', ['running', 'awaiting_captcha'])
        .order('started_at', { ascending: false }),
      supabase
        .from('huma_jobs')
        .select(JOB_ACCOUNT_SELECT, { count: 'exact' })
        .eq('workspace', workspace)
        .order('created_at', { ascending: false })
        .range(from, to),
    ]);

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    const live = liveJobs ?? [];
    const liveIds = new Set(live.map((j) => j.id));
    const pageRows = (data ?? []).filter((j) => !liveIds.has(j.id));
    const items = attachPostingAccountLabels(filterOutPipelineShells([...live, ...pageRows]));
    const shellTotal = await countContentFullPipelineShells(workspace);

    const stats = await fetchQueueStats(workspace);
    return {
      items,
      total: Math.max(0, (count ?? 0) - shellTotal),
      stats,
    };
  });

  app.get('/api/jobs/nav-badges', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    const { workspace: workspaceQuery } = request.query as { workspace?: string };
    const workspaces =
      workspaceQuery && allowed.includes(workspaceQuery) ? [workspaceQuery] : allowed;
    const dayAgo = new Date(Date.now() - 86400000).toISOString();

    const [
      { count: pending },
      { count: scheduled },
      { count: video },
      { data: watcherErrorRows },
    ] = await Promise.all([
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'pending'),
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'scheduled'),
      supabase.from('huma_video_queue').select('*', { count: 'exact', head: true }).in('workspace', workspaces).in('status', ['pending', 'image_generating', 'video_generating', 'tts_generating', 'lipsync_generating', 'finalizing', 'uploading']),
      supabase.from('huma_logs').select('message').in('workspace', workspaces).eq('level', 'ERROR').gte('created_at', dayAgo),
    ]);

    const watcherErrors = (watcherErrorRows ?? []).filter(
      (row) => !isVideoContentOperationalLog(String(row.message ?? '')),
    ).length;

    return {
      queue: (pending ?? 0) + (scheduled ?? 0),
      video: video ?? 0,
      watcher: watcherErrors,
    };
  });

  app.post('/api/jobs', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const allowedWorkspaces = getWorkspaceFilter(request);

    if (body.workspace && !allowedWorkspaces.includes(body.workspace as string)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    const sourceUrl = (body.sourceUrl ?? body.source_url) as string | undefined;
    const contentType = (body.content_type ?? body.contentType) as 'A' | 'B' | undefined;
    const contentTypeAuto =
      typeof body.content_type_auto === 'boolean'
        ? body.content_type_auto
        : typeof body.contentTypeAuto === 'boolean'
          ? body.contentTypeAuto
          : contentType == null;
    const autoSchedule = body.auto_schedule ?? body.autoSchedule;
    const isAutoContentJob =
      (body.job_type as string | undefined) === 'content_full' ||
      (Boolean(sourceUrl?.toString().trim()) && Boolean(body.title));
    if (body.workspace && isAutoContentJob) {
      if (!allowedWorkspaces.includes(body.workspace as string)) {
        return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
      }
      try {
        const autoScheduled = autoSchedule !== false;
        const scheduledAt =
          (body.scheduled_at as string) ||
          resolveAutoContentStartAt(autoScheduled, (body.schedule_time as string) ?? undefined);
        const accountId = (body.account_id as string | undefined)?.trim();
        const isSchedulerAutoPublish = body.auto_publish === true;
        if (!accountId && !isSchedulerAutoPublish) {
          return reply.code(400).send({ error: '포스팅 계정(account_id)을 선택하세요' });
        }
        const result = await registerAutoContentJobs({
          workspace: body.workspace as string,
          account_id: accountId || undefined,
          title: body.title ? String(body.title).trim() : undefined,
          source_url: sourceUrl?.toString().trim() || undefined,
          synopsis: (body.synopsis as string | undefined)?.trim(),
          uploaded_images:
            normalizeUploadedImagesInput(body.uploaded_images ?? body.uploadedImages) ??
            ((body.screenshotBase64 ?? body.screenshot_base64) as string | undefined)?.trim()
              ? [String(body.screenshotBase64 ?? body.screenshot_base64).trim()]
              : undefined,
          content_type: contentType,
          content_type_auto: contentTypeAuto,
          auto_schedule: autoScheduled,
          scheduled_at: scheduledAt,
          repeat_rule: (body.repeat_rule as string) || null,
        });
        return {
          ...result.primary_job,
          _meta: { jobs_created: result.jobs_created, video_queue_id: result.video_queue_id },
        };
      } catch (err) {
        const msg = (err as Error).message ?? 'AI 콘텐츠 생성 실패';
        return reply.code(postingQuotaErrorStatus(msg)).send({ error: msg });
      }
    }

    const scheduledAt = body.scheduled_at as string | undefined;
    const status = resolveJobStatus(scheduledAt);
    const jobType = body.job_type as string | undefined;
    const accountId = body.account_id as string | undefined;

    try {
      if (jobType === 'cafe_new_post' && accountId) await assertCafeNewPostAccount(accountId);
      if (jobType === 'cafe_reply' && accountId) await assertCafeReplyAccount(accountId);
      if (jobType === 'social_crank' && accountId) {
        await assertManualSocialCrankAllowed(accountId, body.content as string | undefined);
      }
      await assertHumaJobRunnable({ job_type: jobType, account_id: accountId });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }

    const { data, error } = await supabase      .from('huma_jobs')
      .insert({ ...body, status, retry_count: body.retry_count ?? 0 })
      .select()
      .single();
    if (error) return reply.code(400).send({ error: error.message });

    if (data) {
      await enqueueHumaJob(data as JobRecord);
      const { data: updated } = await supabase.from('huma_jobs').select('*').eq('id', data.id).single();
      return updated ?? data;
    }
    return data;
  });

  app.post(
    '/api/jobs/upload-image',
    { preHandler: authMiddleware, bodyLimit: 12 * 1024 * 1024 },
    async (request, reply) => {
      const body = request.body as {
        workspace?: string;
        slot_index?: number;
        image_data?: string;
      };
      const allowedWorkspaces = getWorkspaceFilter(request);

      if (!body.workspace || !allowedWorkspaces.includes(body.workspace)) {
        return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
      }
      const slotIndex = Number(body.slot_index);
      if (!Number.isInteger(slotIndex) || slotIndex < 1 || slotIndex > 5) {
        return reply.code(400).send({ error: 'slot_index는 1~5 정수여야 합니다' });
      }
      if (!body.image_data?.trim() || !body.image_data.trim().startsWith('data:')) {
        return reply.code(400).send({ error: 'image_data(data URL)가 필요합니다' });
      }

      try {
        const url = await persistSingleJobImageDataUrl(body.image_data.trim(), slotIndex);
        return { url };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message ?? '이미지 업로드 실패' });
      }
    },
  );

  app.get('/api/jobs/auto-publish/status', { preHandler: authMiddleware }, async (request, reply) => {
    const { workspace } = request.query as { workspace?: string };
    const allowedWorkspaces = getWorkspaceFilter(request);

    if (!workspace || !allowedWorkspaces.includes(workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    try {
      const { resolveEarliestNextPublish } = await import('../lib/next-publish-schedule.js');
      const [status, next] = await Promise.all([
        fetchAutoPublishStatus(workspace),
        resolveEarliestNextPublish([workspace]),
      ]);
      return { ...status, next_publish_account_id: next.account_id };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message ?? '상태 조회 실패' });
    }
  });

  app.get('/api/jobs/auto-publish/accounts', { preHandler: authMiddleware }, async (request, reply) => {
    const { workspace } = request.query as { workspace?: string };
    const allowedWorkspaces = getWorkspaceFilter(request);

    if (!workspace || !allowedWorkspaces.includes(workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    try {
      const { resolveEarliestNextPublish } = await import('../lib/next-publish-schedule.js');
      const accounts = await fetchAutoPublishAccountsStatus(workspace);
      const next = await resolveEarliestNextPublish([workspace]);
      return { accounts, next_publish_account_id: next.account_id };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message ?? '계정 현황 조회 실패' });
    }
  });

  app.post('/api/jobs/auto-publish', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as { workspace?: string; account_id?: string; enabled?: boolean };
    const allowedWorkspaces = getWorkspaceFilter(request);

    if (!body.workspace || !allowedWorkspaces.includes(body.workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    try {
      const accountId = body.account_id?.trim();
      if (!accountId) {
        return reply.code(400).send({ error: '자동발행은 account_id가 필요합니다' });
      }

      const { data: row } = await supabase
        .from('huma_accounts')
        .select('auto_publish_enabled')
        .eq('id', accountId)
        .maybeSingle();

      const nextEnabled = typeof body.enabled === 'boolean' ? body.enabled : !row?.auto_publish_enabled;
      const result = await toggleAutoPublish(body.workspace, accountId, nextEnabled);

      return {
        ok: true,
        enabled: result.enabled,
        planned_count: result.planned_count,
        remaining_today: result.remaining_today,
        next_slot_at: result.next_slot_at,
        _meta: {
          daily_status: result.status,
          accounts_status: result.accounts_status,
        },
      };
    } catch (err) {
      const msg = (err as Error).message ?? '자동 발행 실패';
      if (
        msg.includes('한도') ||
        msg.includes('OFF') ||
        msg.includes('야간') ||
        msg.includes('캐시') ||
        msg.includes('불가')
      ) {
        return reply.code(429).send({ error: msg });
      }
      return reply.code(500).send({ error: msg });
    }
  });

  app.post('/api/jobs/content-preview', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as {
      workspace?: string;
      title?: string;
      source_url?: string;
      synopsis?: string;
      uploaded_images?: string[];
      screenshot_base64?: string;
      content_type?: 'A' | 'B';
      account_id?: string;
    };
    const allowedWorkspaces = getWorkspaceFilter(request);

    if (!body.workspace || !allowedWorkspaces.includes(body.workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    try {
      const result = await runContentPreview({
        workspace: body.workspace,
        title: body.title?.trim() || undefined,
        source_url: body.source_url?.trim() || undefined,
        synopsis: body.synopsis?.trim(),
        uploaded_images:
          normalizeUploadedImagesInput(body.uploaded_images) ??
          (body.screenshot_base64?.trim() ? [body.screenshot_base64.trim()] : undefined),
        content_type: body.content_type ?? 'A',
        account_id: body.account_id,
      });
      const failed = result.steps.some((s) => s.status === 'err');
      if (failed) return reply.code(502).send({ error: '콘텐츠 검증 실패', ...result });
      return result;
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message ?? '검증 실패' });
    }
  });

  app.post('/api/jobs/auto-content', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as {
      workspace?: string;
      account_id?: string;
      title?: string;
      source_url?: string;
      synopsis?: string;
      uploaded_images?: string[];
      screenshot_base64?: string;
      content_type?: 'A' | 'B';
      content_type_auto?: boolean;
      auto_schedule?: boolean;
      schedule_time?: string;
      repeat_rule?: string;
      dry_run?: boolean;
    };
    const allowedWorkspaces = getWorkspaceFilter(request);

    if (!body.workspace || !allowedWorkspaces.includes(body.workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    try {
      const autoScheduled = body.auto_schedule !== false;
      const scheduledAt = resolveAutoContentStartAt(autoScheduled, body.schedule_time);
      const result = await registerAutoContentJobs({
        workspace: body.workspace,
        account_id: body.account_id?.trim() || undefined,
        title: body.title?.trim() || undefined,
        source_url: body.source_url?.trim() || undefined,
        synopsis: body.synopsis?.trim(),
        uploaded_images:
          normalizeUploadedImagesInput(body.uploaded_images) ??
          (body.screenshot_base64?.trim() ? [body.screenshot_base64.trim()] : undefined),
        content_type: body.content_type,
        content_type_auto: body.content_type_auto ?? body.content_type == null,
        auto_schedule: autoScheduled,
        scheduled_at: scheduledAt,
        repeat_rule: body.repeat_rule || null,
        dry_run: body.dry_run === true,
      });
      return {
        ...result.primary_job,
        _meta: {
          jobs_created: result.jobs_created,
          video_queue_id: result.video_queue_id,
          auto_picked: result.auto_picked,
          auto_pick_label: result.auto_pick_label,
        },
      };
    } catch (err) {
      const msg = (err as Error).message ?? 'AI 콘텐츠 생성 실패';
      return reply.code(postingQuotaErrorStatus(msg)).send({ error: msg });
    }
  });

  app.post('/api/jobs/:id/publish-from-preview', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);

    const { data: job } = await supabase.from('huma_jobs').select('workspace').eq('id', id).maybeSingle();
    if (!job) return reply.code(404).send({ error: '작업 없음' });
    if (!allowedWorkspaces.includes(job.workspace as string)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    try {
      const result = await promoteDryRunToPublish(id);
      return {
        success: true,
        blog_job_id: result.primaryJobId,
        jobs_created: result.jobsCreated,
        video_queue_id: result.video_queue_id,
      };
    } catch (err) {
      const msg = (err as Error).message ?? '발행 큐 등록 실패';
      const code = postingQuotaErrorStatus(msg);
      return reply.code(code === 500 ? 400 : code).send({ error: msg });
    }
  });

  app.patch('/api/jobs/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const access = await assertJobWorkspaceAccess(id, getWorkspaceFilter(request));
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data: existing } = await supabase.from('huma_jobs').select('*').eq('id', id).single();
    if (!existing) return reply.code(404).send({ error: '작업 없음' });

    const patch: Record<string, unknown> = {};
    if (typeof body.title === 'string') patch.title = body.title.trim();
    if (body.content === null || typeof body.content === 'string') patch.content = body.content;
    if (typeof body.scheduled_at === 'string') patch.scheduled_at = body.scheduled_at;
    if (body.link_url === null || typeof body.link_url === 'string') patch.link_url = body.link_url;
    if (body.repeat_rule === null || typeof body.repeat_rule === 'string') patch.repeat_rule = body.repeat_rule;
    if (Array.isArray(body.hashtags)) patch.hashtags = body.hashtags;
    if (typeof body.content_type === 'string') patch.content_type = body.content_type;
    if (typeof body.content_type_auto === 'boolean') patch.content_type_auto = body.content_type_auto;
    if (typeof body.auto_scheduled === 'boolean') patch.auto_scheduled = body.auto_scheduled;
    if (Array.isArray(body.image_urls)) patch.image_urls = body.image_urls;

    const scheduledAt = (patch.scheduled_at ?? existing.scheduled_at) as string | undefined;
    const status = ['completed', 'failed', 'running'].includes(existing.status)
      ? existing.status
      : resolveJobStatus(scheduledAt);

    const { data, error } = await supabase
      .from('huma_jobs')
      .update({ ...patch, status })
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.code(400).send({ error: error.message });

    if (data && ['scheduled', 'pending', 'paused'].includes(data.status)) {
      await removeBullJob(existing.bull_job_id);
      if (data.status !== 'paused') {
        await enqueueHumaJob(data as JobRecord);
      }
    }

    return data;
  });

  app.patch('/api/jobs/:id/pause', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await assertJobWorkspaceAccess(id, getWorkspaceFilter(request));
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', id).single();
    if (job?.bull_job_id) await removeBullJob(job.bull_job_id);

    const { data } = await supabase
      .from('huma_jobs')
      .update({ status: 'paused', bull_job_id: null })
      .eq('id', id)
      .select()
      .single();
    return data;
  });

  app.patch('/api/jobs/:id/resume', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await assertJobWorkspaceAccess(id, getWorkspaceFilter(request));
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', id).single();
    if (!job) return reply.code(404).send({ error: '작업 없음' });

    try {
      await assertHumaJobRunnable(job);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }

    const { data, error } = await supabase
      .from('huma_jobs')
      .update({ status: resolveJobStatus(job.scheduled_at) })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) {
      return reply.code(500).send({ error: error?.message ?? '작업 재개 실패' });
    }

    await enqueueHumaJob(data as JobRecord);
    return data;
  });

  /** v3.27 ⏫ 스케줄 앞당기기 — 다음 실행 우선 (즉시 강제 실행 아님) */
  app.patch('/api/jobs/:id/advance', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await assertJobWorkspaceAccess(id, getWorkspaceFilter(request));
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', id).single();
    if (!job) return reply.code(404).send({ error: '작업 없음' });
    if (!['pending', 'scheduled', 'paused'].includes(String(job.status))) {
      return reply.code(400).send({ error: '대기·예약·일시정지 작업만 앞당길 수 있습니다' });
    }

    try {
      await assertHumaJobAdvanceAllowed(job);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }

    const now = new Date().toISOString();
    await removeBullJob(job.bull_job_id);
    await removeBullJob(`huma-${id}`);

    const basePatch = {
      scheduled_at: now,
      status: 'pending' as const,
      error_message: null,
      started_at: null,
    };
    let updated = await supabase
      .from('huma_jobs')
      .update({ ...basePatch, advance_requested_at: now })
      .eq('id', id)
      .select()
      .single();
    if (updated.error) {
      updated = await supabase.from('huma_jobs').update(basePatch).eq('id', id).select().single();
    }
    const { data, error } = updated;
    if (error || !data) {
      return reply.code(500).send({ error: error?.message ?? '작업 상태 갱신 실패' });
    }

    await enqueueHumaJob(data as JobRecord, {
      immediate: true,
      jobId: `huma-${id}-advance-${Date.now()}`,
      priority: 1_000_000,
    });
    return data;
  });

  /** 고착 LIVE·CAPTCHA — 세션·락 해제 후 failed 또는 삭제 */
  app.post<{ Params: { id: string } }>('/api/jobs/:id/abort', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params;
    const access = await assertJobWorkspaceAccess(id, getWorkspaceFilter(request));
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const body = (request.body ?? {}) as { delete?: boolean };
    const result = await abortHumaJobById(id, { deleteAfter: body.delete === true });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { success: true, deleted: result.deleted };
  });

  app.delete('/api/jobs/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);
    const access = await assertJobWorkspaceAccess(id, allowedWorkspaces);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const result = await deleteJobById(id);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { success: true };
  });

  app.post('/api/jobs/bulk-delete', { preHandler: authMiddleware }, async (request, reply) => {
    const allowedWorkspaces = getWorkspaceFilter(request);
    const { ids } = request.body as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: '삭제할 작업 id가 없습니다' });
    }

    const allowedIds: string[] = [];
    for (const id of ids) {
      const access = await assertJobWorkspaceAccess(id, allowedWorkspaces);
      if (access.ok) allowedIds.push(id);
    }

    if (allowedIds.length === 0) {
      return reply.code(403).send({ error: '삭제 가능한 작업이 없습니다' });
    }

    const result = await deleteJobsByIds(allowedIds);
    if (result.deleted === 0) {
      return reply.code(400).send({
        error: result.errors[0] ?? '삭제 실패',
        deleted: 0,
        failed: result.failed,
        errors: result.errors,
      });
    }

    return {
      success: true,
      deleted: result.deleted,
      failed: result.failed,
      errors: result.errors,
    };
  });

  app.post('/api/jobs/:id/run-now', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await assertJobWorkspaceAccess(id, getWorkspaceFilter(request));
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', id).single();
    if (!job) return { error: '작업 없음' };

    try {
      if (job.job_type === 'social_crank' && job.account_id) {
        await assertManualSocialCrankAllowed(job.account_id, job.content);
      }
      await assertHumaJobRunnable(job);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }

    await removeBullJob(job.bull_job_id);
    await removeBullJob(`huma-${id}`);

    await enqueueHumaJob(job as JobRecord, {
      immediate: true,
      jobId: `huma-${job.id}-now-${Date.now()}`,
    });

    const { data } = await supabase
      .from('huma_jobs')
      .update({ status: 'pending', scheduled_at: new Date().toISOString(), started_at: null })
      .eq('id', id)
      .select()
      .single();
    return data;
  });

  app.get('/api/jobs/calendar', { preHandler: authMiddleware }, async (request) => {
    const allowedWorkspaces = getWorkspaceFilter(request);
    const { month, workspace } = request.query as { month?: string; workspace?: string };
    const [year, mon] = (month ?? new Date().toISOString().slice(0, 7)).split('-').map(Number);
    const start = new Date(year, mon - 1, 1).toISOString();
    const end = new Date(year, mon, 0, 23, 59, 59).toISOString();

    let query = supabase
      .from('huma_jobs')
      .select(
        'id, title, job_type, status, scheduled_at, workspace, result_url, completed_at, content, image_urls, platform, platform_schedule',
      )
      .in('workspace', allowedWorkspaces)
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('scheduled_at');

    if (workspace && allowedWorkspaces.includes(workspace)) {
      query = query.eq('workspace', workspace);
    }

    const { data } = await query;
    return filterOutPipelineShells(data ?? []);
  });

  app.get('/api/jobs/:id/captcha-hold', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);
    const access = await assertJobWorkspaceAccess(id, allowedWorkspaces);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', id).maybeSingle();
    if (!job) return reply.code(404).send({ error: '작업 없음' });

    const hold = getCaptchaHoldPublicInfo(id);
    return {
      job_status: job.status,
      hold,
      vnc_url: resolveVncUrl(job.workspace),
      web_url: buildJobWebUrl(id),
    };
  });

  app.get('/api/jobs/:id/captcha-screenshot', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);
    const access = await assertJobWorkspaceAccess(id, allowedWorkspaces);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    if (!getCaptchaHold(id)) {
      return reply.code(404).send({ error: 'CAPTCHA 세션이 없습니다' });
    }

    const buf = await readCaptchaHoldScreenshot(id);
    if (!buf?.length) {
      return reply.code(404).send({ error: '캡처 이미지 없음' });
    }

    return reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'no-store')
      .send(buf);
  });

  app.post('/api/jobs/:id/captcha-complete', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);
    const access = await assertJobWorkspaceAccess(id, allowedWorkspaces);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data: job } = await supabase.from('huma_jobs').select('status').eq('id', id).maybeSingle();
    if (!job) return reply.code(404).send({ error: '작업 없음' });
    if (job.status !== 'awaiting_captcha') {
      return reply.code(400).send({ error: '캡cha 대기 상태가 아닙니다' });
    }

    const body = (request.body ?? {}) as { result_url?: string };
    const result = await completeCaptchaHold(id, body.result_url);
    if (!result.ok) return reply.code(409).send({ error: result.error });

    const { data: updated } = await supabase.from('huma_jobs').select('*').eq('id', id).single();
    return updated;
  });

  /** post_blog 일일 집계 디버그 — 서버가 쓰는 resolve 로직 그대로 노출 */
  app.get('/api/jobs/debug/publish-day', { preHandler: authMiddleware }, async (request, reply) => {
    const { workspace, account_id, slot_label } = request.query as {
      workspace?: string;
      account_id?: string;
      slot_label?: string;
    };
    const allowedWorkspaces = getWorkspaceFilter(request);
    if (!workspace || !allowedWorkspaces.includes(workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    let accountId = account_id?.trim();
    if (!accountId && slot_label?.trim()) {
      const { data: acc } = await supabase
        .from('huma_accounts')
        .select('id')
        .eq('workspace', workspace)
        .eq('slot_label', slot_label.trim())
        .maybeSingle();
      accountId = acc?.id as string | undefined;
    }
    if (!accountId) {
      const picked = await pickPostingAccount(workspace, { advance: false });
      accountId = picked?.id;
    }
    if (!accountId) return reply.code(404).send({ error: '포스팅 계정 없음' });

    const [explain, queueStats] = await Promise.all([
      explainPostBlogPublishDay(accountId),
      computeVisibleQueueStats(workspace, kstTodayStartIso()),
    ]);

    return {
      account_id: accountId,
      kst_today: explain.kst_today,
      today_completed_post_blog: explain.today_count,
      queue_done_today: queueStats.doneToday,
      jobs: explain.jobs,
    };
  });

  /** 자동발행 due 차단 원인 진단 — 연운1~3 비교용 */
  app.get('/api/jobs/debug/auto-publish', { preHandler: authMiddleware }, async (request, reply) => {
    const { workspace, slot_label } = request.query as {
      workspace?: string;
      slot_label?: string;
    };
    const allowedWorkspaces = getWorkspaceFilter(request);
    if (!workspace || !allowedWorkspaces.includes(workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    const slotLabels = slot_label?.trim() ? [slot_label.trim()] : undefined;
    const accounts = await diagnoseAutoPublishWorkspace(workspace, slotLabels);
    return { workspace, accounts };
  });

  /** post_blog — 네이버에 이미 발행됐으나 failed·LIVE로 남은 job 상태 정정 */
  app.post('/api/jobs/:id/reconcile-publish', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);
    const access = await assertJobWorkspaceAccess(id, allowedWorkspaces);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const result = await reconcilePostBlogJobById(id);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });

    const { data: updated } = await supabase.from('huma_jobs').select('*').eq('id', id).single();
    return { ok: true, result_url: result.result_url, job: updated };
  });

  /** post_blog — ✓ 발행 확인을 잘못 눌렀을 때 completed 되돌리기 */
  app.post('/api/jobs/:id/revert-publish', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);
    const access = await assertJobWorkspaceAccess(id, allowedWorkspaces);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data: job } = await supabase
      .from('huma_jobs')
      .select('job_type, status')
      .eq('id', id)
      .maybeSingle();
    if (!job) return reply.code(404).send({ error: '작업 없음' });
    if (job.job_type !== 'post_blog') {
      return reply.code(400).send({ error: 'post_blog 작업만 지원합니다' });
    }
    if (job.status !== 'completed') {
      return reply.code(400).send({ error: 'completed 상태 job만 취소할 수 있습니다' });
    }

    try {
      const ok = await revertPostBlogCompletion(id);
      if (!ok) return reply.code(409).send({ error: '발행 완료 취소 실패' });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }

    const { data: updated } = await supabase.from('huma_jobs').select('*').eq('id', id).single();
    return { ok: true, job: updated };
  });

  /** 캡차 정답 원격 입력 — VNC 한글 IME 불필요 (웹에서 입력 → Playwright insertText 주입) */
  app.post('/api/jobs/:id/captcha-answer', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);
    const access = await assertJobWorkspaceAccess(id, allowedWorkspaces);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const body = (request.body ?? {}) as { answer?: string };
    const answer = body.answer?.trim();
    if (!answer) return reply.code(400).send({ error: '정답을 입력해 주세요' });

    const result = await submitCaptchaAnswerForJob(id, answer);
    if (!result.ok) {
      return reply.code(409).send({ error: result.error });
    }

    const holdInfo = getCaptchaHoldPublicInfo(id);

    return {
      ok: true,
      submitted: result.submitted,
      captcha_cleared: result.captcha_cleared,
      pending_login: result.pending_login,
      captcha_still_visible: result.captcha_still_visible,
      auto_resumed: false,
      hold: holdInfo,
    };
  });

  app.get('/api/jobs/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);
    const access = await assertJobWorkspaceAccess(id, allowedWorkspaces);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data, error } = await supabase.from('huma_jobs').select('*').eq('id', id).maybeSingle();
    if (error || !data) return reply.code(404).send({ error: '작업 없음' });
    return data;
  });

  /** Imagen 미리보기 — Storage 비공개 버킷도 Service Key로 스트리밍 */
  app.get('/api/jobs/:id/preview-image', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);
    const access = await assertJobWorkspaceAccess(id, allowedWorkspaces);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data: job, error } = await supabase
      .from('huma_jobs')
      .select('image_urls, platform_schedule')
      .eq('id', id)
      .maybeSingle();
    if (error || !job) return reply.code(404).send({ error: '작업 없음' });

    const mediaUrl = resolveJobPreviewImageUrl(job);
    if (!mediaUrl) return reply.code(404).send({ error: '생성 이미지 없음' });

    const storagePath = parseHumaMediaStoragePath(mediaUrl);
    if (!storagePath) return reply.code(404).send({ error: 'Storage 경로 파싱 실패' });

    try {
      const buf = await downloadHumaMedia(storagePath);
      return reply
        .type('image/jpeg')
        .header('Cache-Control', 'private, max-age=3600')
        .send(buf);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.get('/api/jobs/:id/crank-session', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);

    const { data: job } = await supabase
      .from('huma_jobs')
      .select('workspace')
      .eq('id', id)
      .maybeSingle();

    if (!job) return reply.code(404).send({ error: '작업 없음' });
    if (job.workspace && !allowedWorkspaces.includes(job.workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    const detail = await getCrankJobSessionDetail(id);
    if (!detail) return reply.code(404).send({ error: 'C-Rank 작업 아님' });
    return detail;
  });
}
