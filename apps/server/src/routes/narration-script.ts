import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter } from '../middleware/auth.js';
import { supabase } from '../middleware/auth.js';
import { enqueueJob } from '../modules/queue/producer.js';
import type {
  NarrationAxisType,
  NarrationFormatType,
  NarrationScriptWorkspace,
} from '@huma/shared';
import {
  createNarrationScriptJob,
  recoverStaleNarrationScripts,
  runNarrationScriptGeneration,
} from '../modules/narration-script/pipeline.js';
import { previewNextNarrationPick, planNarrationPick } from '../modules/narration-script/pick-plan.js';
import { listNarrationTopics } from '../modules/narration-script/topic-pool.js';
import {
  getFortune82LastSyncTime,
  syncFortune82ProductsCache,
} from '../modules/narration-script/fortune82-product-cache.js';
import { NARRATION_ROTATION_COOLDOWN_DAYS } from '../modules/narration-script/rotation.js';
import { initialNarrationProgressMeta } from '../modules/narration-script/progress.js';
import { cancelNarrationScriptJob, narrationScriptQueueJobId } from '../modules/narration-script/cancel.js';

const NARRATION_WORKSPACES: NarrationScriptWorkspace[] = ['yeonun', 'fortune82'];

function assertNarrationWorkspace(
  ws: string,
  allowed: string[],
): ws is NarrationScriptWorkspace {
  return NARRATION_WORKSPACES.includes(ws as NarrationScriptWorkspace) && allowed.includes(ws);
}

export function registerNarrationScriptRoutes(app: FastifyInstance) {
  app.get('/api/narration-scripts', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    const { workspace, status } = request.query as { workspace?: string; status?: string };

    let query = supabase
      .from('huma_narration_script_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (workspace?.trim() && assertNarrationWorkspace(workspace.trim(), allowed)) {
      query = query.eq('workspace', workspace.trim());
    } else {
      query = query.in(
        'workspace',
        NARRATION_WORKSPACES.filter((w) => allowed.includes(w)),
      );
    }

    if (status?.trim()) query = query.eq('status', status.trim());

    if (workspace?.trim() && assertNarrationWorkspace(workspace.trim(), allowed)) {
      await recoverStaleNarrationScripts(workspace.trim());
    } else {
      for (const ws of NARRATION_WORKSPACES.filter((w) => allowed.includes(w))) {
        await recoverStaleNarrationScripts(ws);
      }
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

  app.get('/api/narration-scripts/topics', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    const { workspace } = request.query as { workspace?: string };
    const ws = (workspace ?? 'yeonun').trim();
    if (!assertNarrationWorkspace(ws, allowed)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    const topics = await listNarrationTopics(ws);
    const lastSync = ws === 'fortune82' ? await getFortune82LastSyncTime() : null;
    return { workspace: ws, topics, lastSync, rotationDays: NARRATION_ROTATION_COOLDOWN_DAYS };
  });

  app.get('/api/narration-scripts/next-pick', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    const { workspace, format_type } = request.query as { workspace?: string; format_type?: string };
    const ws = (workspace ?? 'yeonun').trim();
    if (!assertNarrationWorkspace(ws, allowed)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    const formatType = (format_type === 'ranked' ? 'ranked' : 'full_cover') as NarrationFormatType;
    try {
      const plan = await previewNextNarrationPick(ws, formatType);
      return {
        workspace: plan.workspace,
        format_type: plan.formatType,
        axis_type: plan.axisType,
        topic_key: plan.topic.key,
        topic_label: plan.topic.label,
      };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/narration-scripts/generate', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    const body = request.body as {
      workspace?: string;
      format_type?: NarrationFormatType;
      axis_type?: NarrationAxisType | 'auto';
      topic_key?: string | null;
    };

    const ws = (body.workspace ?? 'yeonun').trim();
    if (!assertNarrationWorkspace(ws, allowed)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    const formatType = body.format_type === 'ranked' ? 'ranked' : 'full_cover';

    const { data: busy } = await supabase
      .from('huma_narration_script_history')
      .select('id')
      .eq('workspace', ws)
      .eq('status', 'script_generating')
      .limit(1);
    if ((busy ?? []).length > 0) {
      return reply.code(409).send({ error: '이미 나레이션 대본 생성이 진행 중입니다' });
    }

    try {
      const id = await createNarrationScriptJob({
        workspace: ws,
        formatType,
        axisType: body.axis_type ?? 'auto',
        topicKey: body.topic_key ?? null,
      });

      await enqueueJob(
        {
          type: 'narration_script_generate',
          payload: { historyId: id },
        },
        { jobId: narrationScriptQueueJobId(id) },
      );

      return { ok: true, id, message: '나레이션 대본 생성이 큐에 등록되었습니다' };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/narration-scripts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('huma_narration_script_history')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(data.workspace as string)) {
      return reply.code(403).send({ error: '권한 없음' });
    }
    return data;
  });

  app.patch('/api/narration-scripts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    const { id } = request.params as { id: string };
    const body = request.body as { title?: string; script_body?: string };

    const { data: row } = await supabase
      .from('huma_narration_script_history')
      .select('workspace, status')
      .eq('id', id)
      .maybeSingle();
    if (!row) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(row.workspace as string)) {
      return reply.code(403).send({ error: '권한 없음' });
    }
    if (row.status === 'script_generating') {
      return reply.code(409).send({ error: '생성 중에는 수정할 수 없습니다' });
    }

    const patch: Record<string, string> = { updated_at: new Date().toISOString() };
    if (body.title != null) patch.title = String(body.title).trim();
    if (body.script_body != null) patch.script_body = String(body.script_body);

    const { data, error } = await supabase
      .from('huma_narration_script_history')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data;
  });

  app.post('/api/narration-scripts/:id/regenerate', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    const { id } = request.params as { id: string };

    const { data: row } = await supabase
      .from('huma_narration_script_history')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!row) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(row.workspace as string)) {
      return reply.code(403).send({ error: '권한 없음' });
    }

    const prevMeta = (row.source_meta as Record<string, unknown>) ?? {};
    await supabase
      .from('huma_narration_script_history')
      .update({
        status: 'script_generating',
        error_message: null,
        source_meta: initialNarrationProgressMeta({ pick: prevMeta.pick }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    await enqueueJob(
      {
        type: 'narration_script_generate',
        payload: { historyId: id },
      },
      { jobId: narrationScriptQueueJobId(id) },
    );

    return { ok: true, message: '재생성 큐 등록됨' };
  });

  app.post('/api/narration-scripts/:id/cancel', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    const { id } = request.params as { id: string };

    const { data: existing } = await supabase
      .from('huma_narration_script_history')
      .select('workspace')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(existing.workspace as string)) {
      return reply.code(403).send({ error: '권한 없음' });
    }

    const result = await cancelNarrationScriptJob(id);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return { ok: true, previousStatus: result.previousStatus };
  });

  app.delete('/api/narration-scripts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    const { id } = request.params as { id: string };
    const { data: row } = await supabase
      .from('huma_narration_script_history')
      .select('workspace, status')
      .eq('id', id)
      .maybeSingle();
    if (!row) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(row.workspace as string)) {
      return reply.code(403).send({ error: '권한 없음' });
    }
    if (row.status === 'script_generating') {
      return reply.code(409).send({ error: '생성 중에는 삭제할 수 없습니다' });
    }
    await supabase.from('huma_narration_script_history').delete().eq('id', id);
    return { ok: true };
  });

  app.post('/api/fortune82-products/sync', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    if (!allowed.includes('fortune82')) {
      return reply.code(403).send({ error: '포춘82 접근 권한 없음' });
    }
    const result = await syncFortune82ProductsCache();
    if (result.error) return reply.code(502).send({ error: result.error, synced: result.synced });
    return result;
  });
}

export async function executeNarrationScriptGenerate(payload: { historyId: string }) {
  await runNarrationScriptGeneration(payload.historyId);
}
