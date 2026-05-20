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



export async function registerJobRoutes(app: FastifyInstance) {

  app.get('/api/jobs', { preHandler: authMiddleware }, async (request) => {

    const allowedWorkspaces = getWorkspaceFilter(request);

    const { status, workspace, platform, limit = '50' } = request.query as {

      status?: string;

      workspace?: string;

      platform?: string;

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



    const { data, error } = await query;

    if (error) return [];

    return data;

  });



  app.get('/api/jobs/nav-badges', { preHandler: authMiddleware }, async (request) => {

    const workspaces = getWorkspaceFilter(request);

    const dayAgo = new Date(Date.now() - 86400000).toISOString();



    const [

      { count: pending },

      { count: scheduled },

      { count: video },

      { count: watcherErrors },

    ] = await Promise.all([

      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'pending'),

      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'scheduled'),

      supabase.from('huma_video_queue').select('*', { count: 'exact', head: true }).in('workspace', workspaces).in('status', ['pending', 'image_generating', 'video_generating', 'tts_generating', 'lipsync_generating', 'ffmpeg_merging', 'uploading']),

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



    const scheduledAt = body.scheduled_at as string | undefined;

    const status = resolveJobStatus(scheduledAt);



    const { data, error } = await supabase

      .from('huma_jobs')

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



  app.patch('/api/jobs/:id', { preHandler: authMiddleware }, async (request, reply) => {

    const { id } = request.params as { id: string };

    const body = request.body as Record<string, unknown>;



    const { data: existing } = await supabase.from('huma_jobs').select('*').eq('id', id).single();

    if (!existing) return reply.code(404).send({ error: '작업 없음' });



    const scheduledAt = (body.scheduled_at ?? existing.scheduled_at) as string | undefined;

    const status = ['completed', 'failed', 'running'].includes(existing.status)

      ? existing.status

      : resolveJobStatus(scheduledAt);



    const { data, error } = await supabase

      .from('huma_jobs')

      .update({ ...body, status })

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



  app.patch('/api/jobs/:id/resume', { preHandler: authMiddleware }, async (request) => {

    const { id } = request.params as { id: string };

    const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', id).single();

    if (!job) return { error: '작업 없음' };



    await enqueueHumaJob(job as JobRecord);

    const { data } = await supabase.from('huma_jobs').select('*').eq('id', id).single();

    return data;

  });



  app.delete('/api/jobs/:id', { preHandler: authMiddleware }, async (request) => {

    const { id } = request.params as { id: string };

    const { data: job } = await supabase.from('huma_jobs').select('bull_job_id').eq('id', id).single();

    if (job?.bull_job_id) await removeBullJob(job.bull_job_id);

    await supabase.from('huma_jobs').delete().eq('id', id);

    return { success: true };

  });



  app.post('/api/jobs/:id/run-now', { preHandler: authMiddleware }, async (request) => {

    const { id } = request.params as { id: string };

    const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', id).single();

    if (!job) return { error: '작업 없음' };



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

      .select('id, title, job_type, status, scheduled_at, workspace')

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

}

