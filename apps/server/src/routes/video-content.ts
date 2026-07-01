import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'fs';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { mapAccountDbError } from '../lib/account-errors.js';
import { enqueueJob } from '../modules/queue/producer.js';
import {
  failStaleVideoContentJobs,
  recoverStuckVideoRender,
  runSubtitleReburn,
  syncActiveVideoRenderStatuses,
  revertStaleRenderingJobs,
} from '../modules/video-content/pipeline.js';
import { cancelVideoContentJob } from '../modules/video-content/conti-cancel.js';
import { hasEvoLinkApiKey } from '../modules/video-content/evolink.js';
import { resolveStoredVideoPath } from '../modules/video-content/paths.js';
import { ensureVideoThumbnail } from '../modules/video-content/thumbnail.js';
import {
  bulkDeleteVideoContentFiles,
  deleteVideoContentFileForHistory,
  getVideoContentStorageSettings,
  getVideoContentStorageStats,
  listVideoContentStorageItems,
  removeAllVideoContentFilesForHistory,
  removeVideoContentHistoryIfNoFiles,
  runVideoContentStorageAutoCleanup,
  updateVideoContentStorageSettings,
  type StorageListFilter,
  type VideoContentStorageSettings,
} from '../modules/video-content/storage.js';
import {
  getCharacterAppearanceCounts,
  getLastSyncTime,
  listActivePananaCharacters,
  syncPananaCharacters,
} from '../modules/video-content/panana-characters.js';
import {
  getQuizContentLastSyncTime,
  getQuizUsageCounts,
  listActiveQuizContent,
  syncQuizContentCache,
} from '../modules/video-content/quiz-content-cache.js';
import {
  loadVideoPersonaText,
  saveVideoPersonaText,
} from '../modules/video-content/video-persona-store.js';
import {
  PERSONA_REQUIRED_HEADERS,
  validatePersonaTextHeaders,
} from '../modules/video-content/persona-axis.js';
import {
  applyShotDialoguePatches,
  canEditContiDialogues,
  type ShotDialoguePatch,
} from '../modules/video-content/conti-dialogue-edit.js';
import type { Workspace } from '@huma/shared';

async function assertAccountAccess(
  accountId: string,
  allowed: string[],
): Promise<{ ok: true; workspace: string } | { ok: false; status: number; error: string }> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('workspace')
    .eq('id', accountId)
    .maybeSingle();
  if (!data) return { ok: false, status: 404, error: '계정 없음' };
  if (!allowed.includes(data.workspace)) {
    return { ok: false, status: 403, error: '워크스페이스 접근 권한 없음' };
  }
  return { ok: true, workspace: data.workspace };
}

/** 삭제 불가 — 콘티·영상 파이프라인 전체 */
const IN_PROGRESS_STATUSES = ['conti_generating', 'rendering', 'generating'] as const;
/** Sonnet 콘티 생성 — 계정당 1건 */
const CONTI_BUSY_STATUSES = ['conti_generating'] as const;

async function accountHasBusyHistory(
  accountId: string,
  statuses: readonly string[],
  excludeHistoryId?: string,
): Promise<boolean> {
  let query = supabase
    .from('huma_video_content_history')
    .select('id')
    .eq('account_id', accountId)
    .in('status', [...statuses])
    .limit(1);
  if (excludeHistoryId) query = query.neq('id', excludeHistoryId);
  const { data } = await query;
  return (data?.length ?? 0) > 0;
}

function mapVideoContentListRow(
  row: Record<string, unknown>,
  opts?: { keepContiJson?: boolean },
): Record<string, unknown> {
  const status = String(row.status ?? '');
  let progress_since_at = row.created_at as string;
  if (status === 'rendering' || status === 'generating') {
    const renderStarted = (row.conti_json as Record<string, unknown> | null)?.videoRenderStartedAt;
    if (typeof renderStarted === 'string' && renderStarted.trim()) {
      progress_since_at = renderStarted;
    }
  }
  if (opts?.keepContiJson) {
    return { ...row, progress_since_at };
  }
  const { conti_json: _cj, ...rest } = row;
  return { ...rest, progress_since_at };
}

export async function registerVideoContentRoutes(app: FastifyInstance) {
  app.get('/api/video-content', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    const { account_id, workspace } = request.query as { account_id?: string; workspace?: string };

    await syncActiveVideoRenderStatuses(allowed);
    await revertStaleRenderingJobs(allowed);
    let query = supabase
      .from('huma_video_content_history')
      .select(
        'id, account_id, workspace, status, relationship_axis, emotion_curve, hook_type, cut_type, duration, scenario_summary, similarity_score, self_assessed_humor, retry_count_for_humor, character_used, caption_youtube, caption_tiktok, caption_instagram, caption_threads, caption_x, first_comment_threads, first_comment_x, uploaded_youtube, uploaded_youtube_at, uploaded_tiktok, uploaded_tiktok_at, uploaded_instagram, uploaded_instagram_at, uploaded_threads, uploaded_threads_at, uploaded_x, uploaded_x_at, video_file_path, source_video_path, error_message, conti_generation_sec, created_at, conti_json',
      )
      .in('workspace', allowed)
      .order('created_at', { ascending: false })
      .limit(100);

    if (account_id) query = query.eq('account_id', account_id);
    if (workspace && allowed.includes(workspace)) query = query.eq('workspace', workspace);

    const { data } = await query;
    return (data ?? []).map((row) => mapVideoContentListRow(row as Record<string, unknown>));
  });

  app.get('/api/video-content/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_video_content_history')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!data) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(data.workspace)) return reply.code(403).send({ error: '권한 없음' });
    const taskId = (data.conti_json as Record<string, unknown> | null)?.evolinkTaskId;
    if (data.status === 'conti_ready' && taskId) {
      await supabase
        .from('huma_video_content_history')
        .update({ status: 'rendering', error_message: null })
        .eq('id', id);
      data.status = 'rendering';
      data.error_message = null;
    }
    return mapVideoContentListRow({ ...data, conti_json: data.conti_json }, { keepContiJson: true });
  });

  app.get('/api/video-content/:id/stream', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { variant } = request.query as { variant?: string };
    const allowed = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_video_content_history')
      .select('workspace, video_file_path, source_video_path, status')
      .eq('id', id)
      .maybeSingle();
    if (!data) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(data.workspace)) return reply.code(403).send({ error: '권한 없음' });

    const isSource = variant === 'source';
    const filePath = isSource
      ? resolveStoredVideoPath(id, data.source_video_path, 'source')
      : resolveStoredVideoPath(id, data.video_file_path, 'final');

    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: isSource ? '원본 없음' : '영상 없음' });
    }

    reply.header('Content-Type', 'video/mp4');
    return reply.send(createReadStream(filePath));
  });

  app.get('/api/video-content/:id/thumbnail', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { variant } = request.query as { variant?: string };
    const allowed = getWorkspaceFilter(request);
    const isSource = variant === 'source';
    const fileVariant = isSource ? 'source' : 'subtitled';

    const { data } = await supabase
      .from('huma_video_content_history')
      .select('workspace, video_file_path, source_video_path')
      .eq('id', id)
      .maybeSingle();
    if (!data) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(data.workspace)) return reply.code(403).send({ error: '권한 없음' });

    const videoPath = isSource
      ? resolveStoredVideoPath(id, data.source_video_path, 'source')
      : resolveStoredVideoPath(id, data.video_file_path, 'final');
    if (!existsSync(videoPath)) return reply.code(404).send({ error: '영상 없음' });

    const thumbPath = await ensureVideoThumbnail({
      historyId: id,
      variant: fileVariant,
      videoPath: isSource ? data.source_video_path : data.video_file_path,
    });
    if (!thumbPath || !existsSync(thumbPath)) {
      return reply.code(404).send({ error: '썸네일 생성 실패' });
    }

    reply.header('Content-Type', 'image/jpeg');
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(thumbPath));
  });

  app.get('/api/video-content/:id/download', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { variant } = request.query as { variant?: string };
    const allowed = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_video_content_history')
      .select('workspace, video_file_path, source_video_path')
      .eq('id', id)
      .maybeSingle();
    if (!data) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(data.workspace)) return reply.code(403).send({ error: '권한 없음' });

    const isSource = variant === 'source';
    const filePath = isSource
      ? resolveStoredVideoPath(id, data.source_video_path, 'source')
      : resolveStoredVideoPath(id, data.video_file_path, 'final');

    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: '파일 없음' });
    }

    reply.header('Content-Type', 'video/mp4');
    reply.header(
      'Content-Disposition',
      `attachment; filename="huma-video-${isSource ? 'source-' : ''}${id}.mp4"`,
    );
    return reply.send(createReadStream(filePath));
  });

  app.post('/api/video-content/:id/cancel', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    const { data: existing } = await supabase
      .from('huma_video_content_history')
      .select('workspace')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(existing.workspace)) return reply.code(403).send({ error: '권한 없음' });

    const result = await cancelVideoContentJob(id);
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
    return { ok: true, previousStatus: result.previousStatus };
  });

  app.delete('/api/video-content/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    const { data: existing } = await supabase
      .from('huma_video_content_history')
      .select('workspace, status, video_file_path, source_video_path')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(existing.workspace)) return reply.code(403).send({ error: '권한 없음' });
    if (IN_PROGRESS_STATUSES.includes(existing.status as (typeof IN_PROGRESS_STATUSES)[number])) {
      return reply.code(409).send({ error: '진행 중인 작업은 삭제할 수 없습니다' });
    }

    await removeAllVideoContentFilesForHistory({
      historyId: id,
      videoFilePath: existing.video_file_path,
      sourceVideoPath: existing.source_video_path,
    });

    const { error } = await supabase.from('huma_video_content_history').delete().eq('id', id);
    if (error) return reply.code(400).send({ error: error.message });
    return { ok: true };
  });

  app.patch('/api/video-content/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    const { data: existing } = await supabase
      .from('huma_video_content_history')
      .select('workspace')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(existing.workspace)) return reply.code(403).send({ error: '권한 없음' });

    const body = request.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const platforms = ['youtube', 'tiktok', 'instagram', 'threads', 'x'] as const;

    for (const p of platforms) {
      const key = `uploaded_${p}`;
      if (body[key] !== undefined) {
        patch[key] = Boolean(body[key]);
        patch[`${key}_at`] = body[key] ? new Date().toISOString() : null;
      }
    }

    const { data, error } = await supabase
      .from('huma_video_content_history')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.code(400).send({ error: error.message });
    return data;
  });

  app.patch('/api/video-content/:id/conti-dialogues', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    const { data: existing } = await supabase
      .from('huma_video_content_history')
      .select('workspace, status, conti_json')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(existing.workspace)) return reply.code(403).send({ error: '권한 없음' });
    if (!canEditContiDialogues(existing.status)) {
      return reply.code(409).send({ error: `액션/멘트 수정 불가 상태: ${existing.status}` });
    }

    const body = request.body as { dialogues?: ShotDialoguePatch[] };
    if (!Array.isArray(body.dialogues) || !body.dialogues.length) {
      return reply.code(400).send({ error: 'dialogues 배열이 필요합니다' });
    }

    const contiJson = (existing.conti_json as Record<string, unknown> | null) ?? {};
    let nextContiJson: Record<string, unknown>;
    try {
      nextContiJson = applyShotDialoguePatches(contiJson, body.dialogues);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '액션/멘트 저장 실패';
      return reply.code(400).send({ error: msg });
    }

    const { data, error } = await supabase
      .from('huma_video_content_history')
      .update({ conti_json: nextContiJson })
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.code(400).send({ error: error.message });
    return mapVideoContentListRow({ ...data, conti_json: data.conti_json }, { keepContiJson: true });
  });

  app.get('/api/accounts/:id/video-content-history', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await assertAccountAccess(id, getWorkspaceFilter(request));
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data } = await supabase
      .from('huma_video_content_history')
      .select(
        'id, scenario_summary, similarity_score, self_assessed_humor, retry_count_for_humor, cut_type, duration, relationship_axis, emotion_curve, hook_type, status, created_at',
      )
      .eq('account_id', id)
      .order('created_at', { ascending: false })
      .limit(10);
    return data ?? [];
  });

  app.post('/api/accounts/:id/generate-conti', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await assertAccountAccess(id, getWorkspaceFilter(request));
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    await failStaleVideoContentJobs(id);

    if (await accountHasBusyHistory(id, CONTI_BUSY_STATUSES)) {
      return reply.code(409).send({ error: '이미 콘티 생성이 진행 중입니다' });
    }

    await enqueueJob({
      type: 'video_content_conti',
      payload: { accountId: id },
    });

    return { ok: true, message: '콘티 생성 작업이 큐에 등록되었습니다' };
  });

  app.post('/api/video-content/:id/render-video', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    let { data: row } = await supabase
      .from('huma_video_content_history')
      .select('workspace, status, account_id, conti_json')
      .eq('id', id)
      .maybeSingle();
    if (!row) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(row.workspace)) return reply.code(403).send({ error: '권한 없음' });

    await recoverStuckVideoRender(id);
    await failStaleVideoContentJobs(row.account_id as string);

    ({ data: row } = await supabase
      .from('huma_video_content_history')
      .select('workspace, status, account_id, conti_json')
      .eq('id', id)
      .maybeSingle());
    if (!row) return reply.code(404).send({ error: '없음' });

    const evolinkTaskId = (row.conti_json as Record<string, unknown> | null)?.evolinkTaskId;
    if (row.status === 'rendering' && evolinkTaskId) {
      return reply.code(409).send({ error: 'EvoLink 영상 제작이 이미 진행 중입니다' });
    }
    if (row.status !== 'conti_ready' && row.status !== 'completed') {
      return reply.code(409).send({ error: `영상 제작 불가 상태: ${row.status}` });
    }

    if (!hasEvoLinkApiKey()) {
      return reply.code(503).send({
        error: 'EVOLINK_API_KEY가 설정되지 않았습니다. 서버 .env에 EvoLink API 키를 추가하세요.',
      });
    }

    const renderStartedAt = new Date().toISOString();
    const contiJson = {
      ...((row.conti_json as Record<string, unknown> | null) ?? {}),
      videoRenderStartedAt: renderStartedAt,
    };

    await supabase
      .from('huma_video_content_history')
      .update({ status: 'rendering', error_message: null, conti_json: contiJson })
      .eq('id', id);

    await enqueueJob({
      type: 'video_content_render',
      payload: { historyId: id },
    });

    return { ok: true, message: '숏폼 영상 제작이 시작되었습니다' };
  });

  app.post('/api/video-content/:id/reburn-subtitles', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    const { data: row } = await supabase
      .from('huma_video_content_history')
      .select('workspace, status, account_id, source_video_path')
      .eq('id', id)
      .maybeSingle();
    if (!row) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(row.workspace)) return reply.code(403).send({ error: '권한 없음' });
    if (row.status !== 'completed') {
      return reply.code(409).send({ error: `자막 재입히기 불가 상태: ${row.status}` });
    }

    const sourcePath = resolveStoredVideoPath(id, row.source_video_path, 'source');
    if (!existsSync(sourcePath)) {
      return reply.code(404).send({
        error: '원본 영상이 없습니다. 이 작업은 원본 보관 이전에 생성되었거나 원본이 삭제되었습니다.',
      });
    }

    try {
      await runSubtitleReburn(id);
      return { ok: true, message: '자막을 다시 입혔습니다' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '자막 재입히기 실패';
      return reply.code(500).send({ error: msg });
    }
  });

  app.delete('/api/video-content/:id/video-file', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { target } = request.query as { target?: string };
    const allowed = getWorkspaceFilter(request);

    if (target !== 'source' && target !== 'subtitled') {
      return reply.code(400).send({ error: 'target=source 또는 target=subtitled 필요' });
    }

    const { data: row } = await supabase
      .from('huma_video_content_history')
      .select('workspace, status, video_file_path, source_video_path')
      .eq('id', id)
      .maybeSingle();
    if (!row) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(row.workspace)) return reply.code(403).send({ error: '권한 없음' });
    if (IN_PROGRESS_STATUSES.includes(row.status as (typeof IN_PROGRESS_STATUSES)[number])) {
      return reply.code(409).send({ error: '진행 중인 작업은 파일을 삭제할 수 없습니다' });
    }

    await deleteVideoContentFileForHistory({
      historyId: id,
      target,
      videoFilePath: row.video_file_path,
      sourceVideoPath: row.source_video_path,
    });
    const historyRemoved = await removeVideoContentHistoryIfNoFiles(id);
    return { ok: true, deleted: target, historyRemoved };
  });

  app.get('/api/video-content/storage/stats', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    const { workspace } = request.query as { workspace?: string };
    const workspaces =
      workspace && allowed.includes(workspace) ? [workspace] : allowed;
    const stats = await getVideoContentStorageStats({ allowedWorkspaces: workspaces });
    const settings = await getVideoContentStorageSettings();
    return { stats, settings };
  });

  app.get('/api/video-content/storage/items', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    const { workspace, filter } = request.query as { workspace?: string; filter?: StorageListFilter };
    const workspaces =
      workspace && allowed.includes(workspace) ? [workspace] : allowed;
    const validFilters: StorageListFilter[] = [
      'uploaded_with_source',
      'older_than_30',
      'failed_or_hold',
      'all_with_files',
    ];
    const f = validFilters.includes(filter as StorageListFilter)
      ? (filter as StorageListFilter)
      : 'all_with_files';
    const items = await listVideoContentStorageItems({ allowedWorkspaces: workspaces, filter: f });
    return items;
  });

  app.post('/api/video-content/storage/bulk-delete', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    const body = request.body as { ids?: string[]; target?: string };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : [];
    if (!ids.length) return reply.code(400).send({ error: 'ids 필요' });
    if (body.target !== 'source' && body.target !== 'subtitled') {
      return reply.code(400).send({ error: 'target=source 또는 target=subtitled' });
    }
    const result = await bulkDeleteVideoContentFiles({
      ids,
      target: body.target,
      allowedWorkspaces: allowed,
    });
    return { ok: true, ...result };
  });

  app.get('/api/video-content/storage/settings', { preHandler: authMiddleware }, async () => {
    return getVideoContentStorageSettings();
  });

  app.put('/api/video-content/storage/settings', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as Partial<VideoContentStorageSettings>;
    const next = await updateVideoContentStorageSettings(body);
    return { ok: true, settings: next };
  });

  app.post('/api/video-content/storage/run-cleanup', { preHandler: authMiddleware }, async () => {
    const result = await runVideoContentStorageAutoCleanup();
    return { ok: true, ...result };
  });

  /** @deprecated generate-conti 사용 */
  app.post('/api/accounts/:id/generate-video', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await assertAccountAccess(id, getWorkspaceFilter(request));
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    await failStaleVideoContentJobs(id);

    if (await accountHasBusyHistory(id, CONTI_BUSY_STATUSES)) {
      return reply.code(409).send({ error: '이미 콘티 생성이 진행 중입니다' });
    }

    await enqueueJob({
      type: 'video_content_conti',
      payload: { accountId: id },
    });

    return { ok: true, message: '콘티 생성 작업이 큐에 등록되었습니다' };
  });

  app.get('/api/panana-characters', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    if (!allowed.includes('panana')) return [];
    const chars = await listActivePananaCharacters();
    const { account_id } = request.query as { account_id?: string };
    let counts = new Map<string, number>();
    if (account_id) counts = await getCharacterAppearanceCounts(account_id);
    const lastSync = await getLastSyncTime();
    return {
      characters: chars.map((c) => ({
        ...c,
        appearanceCount: counts.get(c.id) ?? 0,
      })),
      lastSyncedAt: lastSync,
    };
  });

  app.post('/api/panana-characters/sync', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    if (!allowed.includes('panana')) return reply.code(403).send({ error: '권한 없음' });
    const result = await syncPananaCharacters();
    if (result.error && result.synced === 0) return reply.code(502).send(result);
    return result;
  });

  app.get('/api/quiz-content', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    if (!allowed.includes('quizoasis')) return { quizzes: [], lastSyncedAt: null };

    const quizzes = await listActiveQuizContent();
    const counts = await getQuizUsageCounts();
    const lastSyncedAt = await getQuizContentLastSyncTime();
    return {
      quizzes: quizzes.map((q) => ({
        ...q,
        usageCount: counts.get(q.quiz_external_id) ?? 0,
      })),
      lastSyncedAt,
    };
  });

  app.post('/api/quiz-content/sync', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    if (!allowed.includes('quizoasis')) return reply.code(403).send({ error: '권한 없음' });
    const result = await syncQuizContentCache();
    if (result.error && result.synced === 0) return reply.code(502).send(result);
    return result;
  });

  /** EvoLink 작업 완료/실패 콜백 (인증 없음 — HTTPS 공개 URL) */
  app.post('/api/evolink/video-callback', async (request, reply) => {
    const body = request.body as {
      id?: string;
      status?: string;
      error?: { message?: string };
    };
    if (!body.id) return reply.code(400).send({ error: 'task id 없음' });

    if (body.status === 'failed') {
      const { data: rows } = await supabase
        .from('huma_video_content_history')
        .select('id, conti_json')
        .eq('status', 'rendering');
      const row = (rows ?? []).find(
        (r) => (r.conti_json as Record<string, unknown> | null)?.evolinkTaskId === body.id,
      );
      if (row) {
        await supabase
          .from('huma_video_content_history')
          .update({
            status: 'failed',
            error_message: body.error?.message ?? 'EvoLink 생성 실패',
          })
          .eq('id', row.id);
      }
    }

    return { ok: true };
  });

  app.get('/api/workspaces/:workspace/video-persona', { preHandler: authMiddleware }, async (request, reply) => {
    const { workspace } = request.params as { workspace: string };
    const allowed = getWorkspaceFilter(request);
    if (!allowed.includes(workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    if (!['yeonun', 'quizoasis', 'panana'].includes(workspace)) {
      return reply.code(400).send({ error: '지원하지 않는 워크스페이스' });
    }

    const personaText = await loadVideoPersonaText(workspace as Workspace);
    return {
      workspace,
      personaText,
      requiredHeaders: PERSONA_REQUIRED_HEADERS[workspace as keyof typeof PERSONA_REQUIRED_HEADERS],
    };
  });

  app.patch('/api/workspaces/:workspace/video-persona', { preHandler: authMiddleware }, async (request, reply) => {
    const { workspace } = request.params as { workspace: string };
    const allowed = getWorkspaceFilter(request);
    if (!allowed.includes(workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    if (!['yeonun', 'quizoasis', 'panana'].includes(workspace)) {
      return reply.code(400).send({ error: '지원하지 않는 워크스페이스' });
    }

    const body = request.body as { personaText?: string };
    if (typeof body.personaText !== 'string') {
      return reply.code(400).send({ error: 'personaText가 필요합니다' });
    }

    const ws = workspace as Workspace;
    const validation = validatePersonaTextHeaders(body.personaText, PERSONA_REQUIRED_HEADERS[ws]);
    const missingSections = validation.ok ? [] : validation.missing;

    await saveVideoPersonaText(ws, body.personaText);
    return { ok: true, missingSections };
  });
}
