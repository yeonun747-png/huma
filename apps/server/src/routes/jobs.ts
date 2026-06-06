import type { FastifyInstance } from 'fastify';
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
import { assertCafeNewPostAccount, assertCafeReplyAccount } from '../lib/cafe-accounts.js';
import { assertManualSocialCrankAllowed } from '../lib/crank-guard.js';
import { getCrankJobSessionDetail } from '../lib/crank-job-session.js';
import { deleteJobById, deleteJobsByIds } from '../lib/delete-job.js';

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
      .select('*')
      .in('workspace', allowedWorkspaces)
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (status) query = query.eq('status', status);
    if (workspace && allowedWorkspaces.includes(workspace)) query = query.eq('workspace', workspace);
    if (platform) query = query.eq('platform', platform);
    if (job_type) query = query.eq('job_type', job_type);

    const { data, error } = await query;
    if (error) return [];
    return data;
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
      { count: watcherErrors },
    ] = await Promise.all([
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'pending'),
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'scheduled'),
      supabase.from('huma_video_queue').select('*', { count: 'exact', head: true }).in('workspace', workspaces).in('status', ['pending', 'image_generating', 'video_generating', 'tts_generating', 'lipsync_generating', 'finalizing', 'uploading']),
      supabase.from('huma_logs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('level', 'ERROR').gte('created_at', dayAgo),
    ]);

    return {
      queue: (pending ?? 0) + (scheduled ?? 0),
      video: video ?? 0,
      watcher: watcherErrors ?? 0,
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
    if (sourceUrl && body.title) {
      if (!body.workspace || !allowedWorkspaces.includes(body.workspace as string)) {
        return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
      }
      try {
        const autoScheduled = autoSchedule !== false;
        const scheduledAt =
          (body.scheduled_at as string) ||
          resolveAutoContentStartAt(autoScheduled, (body.schedule_time as string) ?? undefined);
        const result = await registerAutoContentJobs({
          workspace: body.workspace as string,
          title: String(body.title).trim(),
          source_url: sourceUrl.trim(),
          synopsis: (body.synopsis as string | undefined)?.trim(),
          screenshot_base64: (body.screenshotBase64 ?? body.screenshot_base64) as string | undefined,
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
        return reply.code(500).send({ error: (err as Error).message ?? 'AI 콘텐츠 생성 실패' });
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

  app.post('/api/jobs/auto-content', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as {
      workspace?: string;
      title?: string;
      source_url?: string;
      synopsis?: string;
      screenshot_base64?: string;
      content_type?: 'A' | 'B';
      content_type_auto?: boolean;
      auto_schedule?: boolean;
      schedule_time?: string;
      repeat_rule?: string;
    };
    const allowedWorkspaces = getWorkspaceFilter(request);

    if (!body.workspace || !allowedWorkspaces.includes(body.workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    if (!body.title?.trim() || !body.source_url?.trim()) {
      return reply.code(400).send({ error: '제목과 URL은 필수입니다' });
    }

    try {
      const autoScheduled = body.auto_schedule !== false;
      const scheduledAt = resolveAutoContentStartAt(autoScheduled, body.schedule_time);
      const result = await registerAutoContentJobs({
        workspace: body.workspace,
        title: body.title.trim(),
        source_url: body.source_url.trim(),
        synopsis: body.synopsis?.trim(),
        screenshot_base64: body.screenshot_base64,
        content_type: body.content_type,
        content_type_auto: body.content_type_auto ?? body.content_type == null,
        auto_schedule: autoScheduled,
        scheduled_at: scheduledAt,
        repeat_rule: body.repeat_rule || null,
      });
      return {
        ...result.primary_job,
        _meta: { jobs_created: result.jobs_created, video_queue_id: result.video_queue_id },
      };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message ?? 'AI 콘텐츠 생성 실패' });
    }
  });

  app.patch('/api/jobs/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

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

  app.patch('/api/jobs/:id/pause', { preHandler: authMiddleware }, async (request) => {
    const { id } = request.params as { id: string };
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
    const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', id).single();
    if (!job) return reply.code(404).send({ error: '작업 없음' });

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
    const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', id).single();
    if (!job) return reply.code(404).send({ error: '작업 없음' });
    if (!['pending', 'scheduled', 'paused'].includes(String(job.status))) {
      return reply.code(400).send({ error: '대기·예약·일시정지 작업만 앞당길 수 있습니다' });
    }

    const now = new Date().toISOString();
    await removeBullJob(job.bull_job_id);
    await removeBullJob(`huma-${id}`);

    const basePatch = {
      scheduled_at: now,
      status: 'pending' as const,
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
    });
    return data;
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
    const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', id).single();
    if (!job) return { error: '작업 없음' };

    if (job.job_type === 'social_crank' && job.account_id) {
      try {
        await assertManualSocialCrankAllowed(job.account_id, job.content);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    }

    await removeBullJob(job.bull_job_id);
    await enqueueJob(buildEnqueuePayload(job as JobRecord), { jobId: `huma-${job.id}-now-${Date.now()}` });

    const { data } = await supabase
      .from('huma_jobs')
      .update({ status: 'pending', started_at: new Date().toISOString() })
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
      .select('id, title, job_type, status, scheduled_at, workspace, result_url, completed_at, content, image_urls, platform')
      .in('workspace', allowedWorkspaces)
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('scheduled_at');

    if (workspace && allowedWorkspaces.includes(workspace)) {
      query = query.eq('workspace', workspace);
    }

    const { data } = await query;
    return data ?? [];
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
