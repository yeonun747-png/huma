import { copyFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Workspace } from '@huma/shared';
import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { isJsonParseError } from '../../lib/llm-json.js';
import { getPipelineModelSettings } from '../../lib/pipeline-settings.js';
import { notifyTelegram } from '../watcher/telegram.js';
import { generatePlatformCaptions, fallbackPlatformCaptions } from './captions.js';
import { ContiValidationError, extractCharacterNamesForStorage, formatContiTokenSettingsLog } from './conti-validation.js';
import {
  buildEvoLinkPrompt,
  createEvoLinkVideoTask,
  downloadEvoLinkVideoToPath,
  handleEvoLinkDownloadFailure,
  pollEvoLinkVideoUrl,
  isEvoLinkPollTimeoutError,
  EVOLINK_POLL_MAX_WAIT_MS,
} from './evolink.js';
import {
  EVOLINK_PROMPT_MAX_LENGTH,
  MAX_PROMPT_LENGTH_RETRIES,
  PROMPT_LENGTH_REGENERATION_FEEDBACK,
  isEvoLinkPromptWithinLimit,
} from './prompt-length.js';
import {
  embedText,
  computeSimilarityScores,
  parseEmbeddingVector,
  MAX_REGENERATION_ATTEMPTS,
  SIMILARITY_THRESHOLD,
} from './embedding.js';
import { buildPreGenerationPlan, type PreGenerationPlan } from './pre-generation-plan.js';
import { runPunchlineContiPipeline, runPunchlineContiStage3Only } from './punchline-pipeline.js';
import type { ContiGenerationResult } from './conti-generator.js';
import {
  pickSubtitleStyle,
  saveSubtitleStyleHistory,
} from './selection.js';
import { burnSubtitles } from './subtitle.js';
import { videoContentFinalPath, videoContentSourcePath } from './paths.js';
import { archiveCurrentVideoFiles, type SupersededVideoArchive } from './video-archive.js';
import { UPLOAD_PLATFORMS } from './storage.js';
import { generateVideoContentThumbnails } from './thumbnail.js';
import {
  assessContiHumor,
  type SelfAssessedHumor,
} from './humor-assessment.js';
import {
  CONTI_GENERATION_BUDGET_MS,
  ContiGenerationBudgetExceeded,
  createContiGenerationBudget,
} from './conti-budget.js';
import {
  assertVideoContentNotCancelled,
  VideoContentCancelledError,
} from './conti-cancel.js';
import { enforceDialogueShotsMinDuration } from './conti-validation.js';
import { mergeShotTimingKeepDialogue } from './dialogue-timing.js';

function contiGenerationSecSince(startedAtIso: string): number {
  const t = new Date(startedAtIso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}
import type { GenerationConditions, VideoConti } from './types.js';

const WEB_BASE = process.env.HUMA_WEB_URL?.trim() || 'http://localhost:3000';
const STALE_VIDEO_CONTENT_MS = CONTI_GENERATION_BUDGET_MS + 60_000;
const STALE_RENDERING_MS = EVOLINK_POLL_MAX_WAIT_MS + 2 * 60_000;

function stripEvoLinkRenderMeta(contiJson: Record<string, unknown>): Record<string, unknown> {
  const next = { ...contiJson };
  delete next.evolinkTaskId;
  delete next.videoRenderStartedAt;
  return next;
}

/** 영상 제작 실패·타임아웃 — 콘티는 유지하고 검토 대기(또는 완료 복구)로 복귀 */
export async function revertVideoRenderToContiReady(
  historyId: string,
  reason: string,
  opts?: { restoreCompleted?: boolean },
): Promise<void> {
  const { data: row } = await supabase
    .from('huma_video_content_history')
    .select('conti_json, status')
    .eq('id', historyId)
    .maybeSingle();
  if (!row) return;

  const contiJson = stripEvoLinkRenderMeta((row.conti_json as Record<string, unknown>) ?? {});
  await supabase
    .from('huma_video_content_history')
    .update({
      status: opts?.restoreCompleted ? 'completed' : 'conti_ready',
      error_message: reason.slice(0, 500),
      conti_json: contiJson,
    })
    .eq('id', historyId);
}

/** worker 중단 등 — rendering 고착을 검토 대기로 복구 (목록 poll) */
export async function revertStaleRenderingJobs(workspaces: string[]): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RENDERING_MS).toISOString();
  const { data: rows } = await supabase
    .from('huma_video_content_history')
    .select('id, conti_json')
    .in('workspace', workspaces)
    .eq('status', 'rendering');

  let reverted = 0;
  for (const row of rows ?? []) {
    const meta = row.conti_json as Record<string, unknown> | null;
    const startedAt = meta?.videoRenderStartedAt;
    const taskId = meta?.evolinkTaskId;
    if (!startedAt) {
      if (!taskId) {
        await revertVideoRenderToContiReady(
          row.id as string,
          '이전 영상 제작 요청이 중단되어 검토 대기로 복구됨',
        );
        reverted += 1;
      }
      continue;
    }
    if (String(startedAt) >= cutoff) continue;
    await revertVideoRenderToContiReady(
      row.id as string,
      'EvoLink 영상 제작 시간 초과 — 검토 대기로 복구됨 (20분)',
    );
    reverted += 1;
  }
  return reverted;
}

/** EvoLink taskId는 있는데 status가 conti_ready로 되돌아간 row — 진행 중으로 복구 */
export async function syncActiveVideoRenderStatuses(workspaces: string[]): Promise<number> {
  const { data: rows } = await supabase
    .from('huma_video_content_history')
    .select('id, status, conti_json')
    .in('workspace', workspaces)
    .eq('status', 'conti_ready');

  let synced = 0;
  for (const row of rows ?? []) {
    const taskId = (row.conti_json as Record<string, unknown> | null)?.evolinkTaskId;
    if (!taskId) continue;
    await supabase
      .from('huma_video_content_history')
      .update({ status: 'rendering', error_message: null })
      .eq('id', row.id);
    synced += 1;
  }
  return synced;
}

/** EvoLink task 없이 rendering에 고착된 row — render 재시도 시에만 복구 (목록 poll에서 호출 금지) */
export async function recoverStuckVideoRender(historyId: string): Promise<boolean> {
  const { data: row } = await supabase
    .from('huma_video_content_history')
    .select('id, status, conti_json')
    .eq('id', historyId)
    .maybeSingle();
  if (!row || row.status !== 'rendering') return false;
  const taskId = (row.conti_json as Record<string, unknown> | null)?.evolinkTaskId;
  if (taskId) return false;

  await supabase
    .from('huma_video_content_history')
    .update({
      status: 'conti_ready',
      error_message: '이전 영상 제작 요청이 중단되어 검토 대기로 복구됨',
    })
    .eq('id', historyId);
  return true;
}

/** 오래 conti_generating에 머문 row만 정리 — rendering은 EvoLink 폴링·동시 n건 제작과 충돌하지 않게 제외 */
export async function failStaleVideoContentJobs(accountId: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_VIDEO_CONTENT_MS).toISOString();
  const { data, error } = await supabase
    .from('huma_video_content_history')
    .update({
      status: 'failed',
      error_message: '콘티 생성 시간 초과 — worker 지연 또는 API 응답 없음',
    })
    .eq('account_id', accountId)
    .eq('status', 'conti_generating')
    .lt('created_at', cutoff)
    .select('id');
  if (error) return 0;
  return data?.length ?? 0;
}

async function loadPastSummaries(accountId: string): Promise<string[]> {
  const { data } = await supabase
    .from('huma_video_content_history')
    .select('scenario_summary')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(10);
  return (data ?? []).map((r) => String(r.scenario_summary ?? '')).filter(Boolean);
}

async function loadRecentCharacterNames(
  accountId: string,
  excludeHistoryId?: string,
  limit = 10,
): Promise<string[]> {
  let query = supabase
    .from('huma_video_content_history')
    .select('character_names')
    .eq('account_id', accountId)
    .not('character_names', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (excludeHistoryId) query = query.neq('id', excludeHistoryId);

  const { data } = await query;
  const out: string[] = [];
  for (const row of data ?? []) {
    const names = row.character_names as string[] | null;
    if (Array.isArray(names)) {
      for (const name of names) {
        if (typeof name === 'string' && name.trim()) out.push(name.trim());
      }
    }
  }
  return out;
}

async function loadPastEmbeddings(accountId: string, excludeHistoryId?: string): Promise<number[][]> {
  let query = supabase
    .from('huma_video_content_history')
    .select('id, embedding_vector')
    .eq('account_id', accountId)
    .not('embedding_vector', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

  if (excludeHistoryId) query = query.neq('id', excludeHistoryId);

  const { data } = await query;
  const out: number[][] = [];
  let parseFailed = 0;
  for (const row of data ?? []) {
    const vec = parseEmbeddingVector(row.embedding_vector);
    if (vec) out.push(vec);
    else parseFailed += 1;
  }

  if (parseFailed > 0) {
    await logOperation({
      level: 'warn',
      message: `[video-content] embedding_vector 파싱 실패 ${parseFailed}건 — JSONB 형식 점검`,
      account_id: accountId,
    });
  }

  return out;
}

async function logContiSimilarityDebug(params: {
  accountId: string;
  historyId: string;
  workspace: Workspace;
  pastEmbCount: number;
  scores: number[];
  maxScore: number;
  textLen: number;
}): Promise<void> {
  const topScores = [...params.scores]
    .sort((a, b) => b - a)
    .slice(0, 3)
    .map((s) => s.toFixed(4))
    .join(', ');

  await logOperation({
    level: 'info',
    message:
      `[video-content] 유사도 검사 — past=${params.pastEmbCount}건 max=${params.maxScore.toFixed(4)} ` +
      `top3=[${topScores || '—'}] textLen=${params.textLen} history=${params.historyId}`,
    workspace: params.workspace,
    account_id: params.accountId,
  });

  if (params.pastEmbCount >= 5 && params.maxScore === 0) {
    await logOperation({
      level: 'warn',
      message:
        `[video-content] 유사도 0 지속 — 과거 ${params.pastEmbCount}건과 비교했으나 max=0. ` +
        'embedding_vector 저장·파싱 또는 fullText 중복 여부를 점검하라.',
      workspace: params.workspace,
      account_id: params.accountId,
    });
  }
}

async function loadRecentCaptions(accountId: string): Promise<string[]> {
  const { data } = await supabase
    .from('huma_video_content_history')
    .select('caption_tiktok, caption_instagram, caption_threads')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(5);
  const out: string[] = [];
  for (const row of data ?? []) {
    for (const k of ['caption_tiktok', 'caption_instagram', 'caption_threads'] as const) {
      const v = row[k];
      if (typeof v === 'string' && v.trim()) out.push(v);
    }
  }
  return out;
}

interface VideoAccountContext {
  accountId: string;
  accountName: string;
  workspace: Workspace;
  plan: PreGenerationPlan;
}

async function loadVideoAccountContext(accountId: string): Promise<VideoAccountContext> {
  const { data: account, error: accErr } = await supabase
    .from('huma_accounts')
    .select('id, name, workspace')
    .eq('id', accountId)
    .maybeSingle();

  if (accErr || !account) throw new Error('계정 없음');
  const workspace = account.workspace as Workspace;
  const plan = await buildPreGenerationPlan({ workspace, accountId });

  return {
    accountId,
    accountName: account.name,
    workspace,
    plan,
  };
}

function conditionsFromHistoryRow(
  row: Record<string, unknown>,
  characterId?: string | null,
): GenerationConditions {
  return {
    relationshipAxis: String(row.relationship_axis ?? ''),
    situationAxis: row.situation_axis ? String(row.situation_axis) : undefined,
    emotionCurve: String(row.emotion_curve ?? ''),
    hookType: String(row.hook_type ?? ''),
    locationKeyword: String(row.location_keyword ?? ''),
    timeOfDay: String(row.time_of_day ?? ''),
    cutType: (row.cut_type === 'single_shot' ? 'single_shot' : 'multi_shot') as 'single_shot' | 'multi_shot',
    duration: Number(row.duration) > 0 ? Number(row.duration) : 15,
    characterId: characterId ?? undefined,
  };
}

function parseContiFromJson(raw: unknown): VideoConti {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    characters: (obj.characters as VideoConti['characters']) ?? [],
    location: String(obj.location ?? ''),
    lighting: String(obj.lighting ?? ''),
    timeOfDay: String(obj.timeOfDay ?? ''),
    cutType: obj.cutType === 'single_shot' ? 'single_shot' : 'multi_shot',
    duration: Number(obj.duration) > 0 ? Number(obj.duration) : 15,
    shots: (obj.shots as VideoConti['shots']) ?? [],
    scenarioSummary: String(obj.scenarioSummary ?? ''),
    fullText: String(obj.fullText ?? obj.scenarioSummary ?? ''),
  };
}

async function finalizeVideoContent(params: {
  historyId: string;
  accountId: string;
  accountName: string;
  workspace: Workspace;
  conti: VideoConti;
  baseConditions: GenerationConditions;
  sourcePath: string;
  contiJson?: Record<string, unknown>;
}): Promise<void> {
  const { historyId, accountId, workspace, accountName, conti, baseConditions, sourcePath, contiJson } =
    params;

  const tmpDir = join(process.cwd(), 'tmp', 'video-content', historyId);
  await mkdir(tmpDir, { recursive: true });

  const sourcePersistPath = videoContentSourcePath(historyId);
  const finalPath = videoContentFinalPath(historyId);
  await mkdir(join(process.cwd(), 'data', 'video-content'), { recursive: true });

  const replacingExisting =
    existsSync(sourcePersistPath) || existsSync(finalPath);
  let archived: SupersededVideoArchive | null = null;
  if (replacingExisting) {
    archived = await archiveCurrentVideoFiles(historyId);
    if (archived) {
      await logOperation({
        level: 'info',
        message: `[video-content] 이전 영상 보관 — history=${historyId}`,
        workspace,
        account_id: accountId,
      });
    } else {
      await logOperation({
        level: 'warn',
        message: `[video-content] 이전 영상 보관 스킵(파일 없음) — history=${historyId}`,
        workspace,
        account_id: accountId,
      });
    }
  }

  if (sourcePath !== sourcePersistPath) {
    await copyFile(sourcePath, sourcePersistPath);
  }

  const subtitleStyle = await pickSubtitleStyle(accountId);
  const subtitledPath = join(tmpDir, 'final.mp4');
  try {
    await burnSubtitles({
      inputVideoPath: sourcePersistPath,
      outputVideoPath: subtitledPath,
      conti,
      style: subtitleStyle,
    });
  } catch (subErr) {
    const msg = (subErr as Error).message;
    await logOperation({
      level: 'warn',
      message: `[video-content] 자막 burn 실패 — Kling 원본 사용: ${msg}`,
      workspace,
      account_id: accountId,
    });
    await copyFile(sourcePersistPath, subtitledPath);
  }
  await saveSubtitleStyleHistory(accountId, subtitleStyle);

  let captions;
  try {
    captions = await generatePlatformCaptions({
      workspace,
      conti,
      hookType: baseConditions.hookType,
      recentCaptions: await loadRecentCaptions(accountId),
    });
  } catch (capErr) {
    const capMsg = (capErr as Error).message;
    await logOperation({
      level: 'warn',
      message: `[video-content] 캡션 생성 실패 — 시나리오 요약으로 완료 처리: ${capMsg.slice(0, 200)}`,
      workspace,
      account_id: accountId,
    });
    captions = fallbackPlatformCaptions(workspace, conti);
  }

  await copyFile(subtitledPath, finalPath);

  await generateVideoContentThumbnails({
    historyId,
    sourcePath: sourcePersistPath,
    subtitledPath: finalPath,
  }).catch(() => {});

  const nextContiJson: Record<string, unknown> = { ...(contiJson ?? {}) };
  if (replacingExisting) {
    if (archived) {
      const prev = Array.isArray(nextContiJson.supersededVideos)
        ? (nextContiJson.supersededVideos as SupersededVideoArchive[])
        : [];
      nextContiJson.supersededVideos = [...prev, archived];
    }
    nextContiJson.videoRenderCount = Number(nextContiJson.videoRenderCount ?? 1) + 1;
  } else if (nextContiJson.videoRenderCount == null) {
    nextContiJson.videoRenderCount = 1;
  }

  const uploadReset: Record<string, boolean | null> = {};
  if (replacingExisting) {
    for (const platform of UPLOAD_PLATFORMS) {
      uploadReset[`uploaded_${platform}`] = false;
      uploadReset[`uploaded_${platform}_at`] = null;
    }
  }

  await supabase
    .from('huma_video_content_history')
    .update({
      status: 'completed',
      video_file_path: finalPath,
      source_video_path: sourcePersistPath,
      caption_youtube: captions.captionYoutube,
      caption_tiktok: captions.captionTiktok,
      caption_instagram: captions.captionInstagram,
      caption_threads: captions.captionThreads,
      caption_x: captions.captionX,
      first_comment_threads: captions.firstCommentThreads,
      first_comment_x: captions.firstCommentX,
      error_message: null,
      conti_json: nextContiJson,
      ...uploadReset,
    })
    .eq('id', historyId);

  const link = `${WEB_BASE}/video-content?id=${historyId}`;
  await notifyTelegram(`✅ 영상 생성 완료\n계정: ${accountName}\n${link}`, workspace);

  await logOperation({
    level: 'info',
    message: `[video-content] 생성 완료 — ${accountName}`,
    workspace,
    account_id: accountId,
  });
}

/** 완료된 작업 — EvoLink 재호출 없이 원본에 자막만 다시 burn */
export async function runSubtitleReburn(historyId: string): Promise<void> {
  const { data: history, error } = await supabase
    .from('huma_video_content_history')
    .select('id, account_id, workspace, status, conti_json, source_video_path, video_file_path')
    .eq('id', historyId)
    .maybeSingle();

  if (error || !history) throw new Error('작업 없음');
  if (history.status !== 'completed') {
    throw new Error(`자막 재입히기 불가 상태: ${history.status}`);
  }

  const accountId = history.account_id as string;
  const workspace = history.workspace as Workspace;
  const sourcePath =
    (history.source_video_path as string | null) || videoContentSourcePath(historyId);

  if (!existsSync(sourcePath)) {
    throw new Error('원본 영상이 서버에 없습니다. (이전 작업이거나 원본이 삭제됨)');
  }

  const conti = parseContiFromJson(history.conti_json);
  const tmpDir = join(process.cwd(), 'tmp', 'video-content', historyId);
  await mkdir(tmpDir, { recursive: true });

  const subtitleStyle = await pickSubtitleStyle(accountId);
  const subtitledPath = join(tmpDir, 'reburn_final.mp4');

  await logOperation({
    level: 'info',
    message: `[video-content] 자막 재입히기 시작 — history=${historyId}`,
    workspace,
    account_id: accountId,
  });

  try {
    await burnSubtitles({
      inputVideoPath: sourcePath,
      outputVideoPath: subtitledPath,
      conti,
      style: subtitleStyle,
    });
  } catch (subErr) {
    const msg = (subErr as Error).message;
    await logOperation({
      level: 'warn',
      message: `[video-content] 자막 재입히기 실패 — ${msg}`,
      workspace,
      account_id: accountId,
    });
    throw new Error(`자막 입히기 실패: ${msg}`);
  }

  await saveSubtitleStyleHistory(accountId, subtitleStyle);

  const finalPath = videoContentFinalPath(historyId);
  await mkdir(join(process.cwd(), 'data', 'video-content'), { recursive: true });
  await copyFile(subtitledPath, finalPath);

  await generateVideoContentThumbnails({
    historyId,
    sourcePath: sourcePath,
    subtitledPath: finalPath,
  }).catch(() => {});

  const patch: Record<string, unknown> = {
    video_file_path: finalPath,
    error_message: null,
  };
  if (!history.source_video_path) {
    patch.source_video_path = sourcePath;
  }

  await supabase.from('huma_video_content_history').update(patch).eq('id', historyId);

  await logOperation({
    level: 'info',
    message: `[video-content] 자막 재입히기 완료 — history=${historyId}`,
    workspace,
    account_id: accountId,
  });
}

/** 1단계 — Sonnet 콘티 생성 (관리자 검토 후 영상 제작) */
export async function runContiGeneration(accountId: string): Promise<string> {
  await failStaleVideoContentJobs(accountId);
  const ctx = await loadVideoAccountContext(accountId);
  const { plan, workspace, accountName } = ctx;
  const baseConditions = plan.conditions;

  const { data: historyRow, error: insertErr } = await supabase
    .from('huma_video_content_history')
    .insert({
      account_id: accountId,
      workspace,
      status: 'conti_generating',
      relationship_axis: baseConditions.relationshipAxis,
      situation_axis: baseConditions.situationAxis ?? null,
      emotion_curve: baseConditions.emotionCurve,
      hook_type: baseConditions.hookType,
      hook_subtype: baseConditions.hookSubtype,
      cut_type: baseConditions.cutType,
      duration: baseConditions.duration,
      character_used: baseConditions.characterId ?? null,
      used_product: plan.yeonunProduct?.slug ?? null,
      used_quiz_id: plan.quizContent?.quizExternalId ?? null,
    })
    .select('id, created_at')
    .single();

  if (insertErr || !historyRow) throw new Error(insertErr?.message ?? '히스토리 생성 실패');
  const historyId = historyRow.id as string;
  const contiStartedAt = String(historyRow.created_at);
  const contiGenSec = () => contiGenerationSecSince(contiStartedAt);
  const budget = createContiGenerationBudget(new Date(contiStartedAt).getTime());
  const assertContiProgress = async () => {
    budget.assert();
    await assertVideoContentNotCancelled(historyId);
  };

  const logStage = async (stage: string) => {
    await logOperation({
      level: 'info',
      message: `[video-content] ${stage}`,
      workspace,
      account_id: accountId,
      metadata: { video_content_history_id: historyId, progress_stage: stage },
    });
  };

  try {
    await logOperation({
      level: 'info',
      message: `[video-content] 콘티 생성 시작 — history=${historyId}`,
      workspace,
      account_id: accountId,
    });

    await logOperation({
      level: 'info',
      message: formatContiTokenSettingsLog(),
      workspace,
      account_id: accountId,
    });

    const pastSummaries = await loadPastSummaries(accountId);
    let conti!: ContiGenerationResult;
    let punchlineIdea = '';
    let mustIncludeProps: string[] = [];
    let embedding: number[] = [];
    let similarityScore = 0;
    let feedback: string | undefined;
    let jsonPipelineRetries = 0;
    const MAX_JSON_PIPELINE_RETRIES = 1;

    for (let attempt = 1; attempt <= MAX_REGENERATION_ATTEMPTS; attempt++) {
      await assertContiProgress();
      await logOperation({
        level: 'info',
        message: `[video-content] 콘티 LLM 시도 ${attempt}/${MAX_REGENERATION_ATTEMPTS} — cut=${baseConditions.cutType} ${baseConditions.duration}초`,
        workspace,
        account_id: accountId,
      });

      let generated: Awaited<ReturnType<typeof runPunchlineContiPipeline>>;
      try {
        generated = await runPunchlineContiPipeline({
          workspace,
          plan,
          pastSummaries,
          feedback,
          punchlineIdea: punchlineIdea || undefined,
          mustIncludeProps: mustIncludeProps.length ? mustIncludeProps : undefined,
          onStage: logStage,
        });
      } catch (err) {
        if (err instanceof ContiValidationError) {
          feedback = err.message;
          if (attempt >= err.maxAttempts) {
            if (err.holdOnFailure) {
              await supabase
                .from('huma_video_content_history')
                .update({
                  status: 'on_hold',
                  error_message: err.message.slice(0, 500),
                  conti_generation_sec: contiGenSec(),
                })
                .eq('id', historyId);
              const holdLabel =
                err.holdReason === 'empty_content'
                  ? '빈 액션/대사 검증 실패'
                  : err.holdReason === 'shot_duration'
                    ? '샷 길이 검증 실패'
                    : err.holdReason === 'generic_action'
                      ? 'filler action 검증 실패'
                      : err.holdReason === 'story_comprehension'
                        ? '3a 이해도 검증 실패'
                        : '콘티 검증 실패';
              await notifyTelegram(
                `⚠️ 영상 콘티 보류 — ${holdLabel}\n계정: ${accountName} (${accountId})\n${err.message}`,
                workspace,
              );
            } else {
              await supabase
                .from('huma_video_content_history')
                .update({
                  status: 'failed',
                  error_message: err.message.slice(0, 500),
                  conti_generation_sec: contiGenSec(),
                })
                .eq('id', historyId);
            }
            throw err;
          }
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (isJsonParseError(err) && jsonPipelineRetries < MAX_JSON_PIPELINE_RETRIES) {
          jsonPipelineRetries++;
          attempt--;
          feedback = `JSON 형식 오류 — ${msg.slice(0, 180)}. narrativeProse·대사 속 큰따옴표는 \\" 또는 「」로, 줄바꿈은 \\n으로 처리 후 다시 생성.`;
          await logOperation({
            level: 'warn',
            message: `[video-content] JSON 파싱 실패 → 파이프라인 재시도 ${jsonPipelineRetries}/${MAX_JSON_PIPELINE_RETRIES}: ${msg.slice(0, 120)}`,
            workspace,
            account_id: accountId,
          });
          continue;
        }
        throw err;
      }

      punchlineIdea = generated.punchlineIdea;
      mustIncludeProps = generated.mustIncludeProps;
      conti = generated.conti;

      if (generated.conti.lastShotIncompleteDetected) {
        await logOperation({
          level: 'warn',
          message:
            `[video-content] 마지막 샷 문장 미완결 감지 — max_tokens 부족 가능성. ${formatContiTokenSettingsLog()}`,
          workspace,
          account_id: accountId,
        });
      }

      embedding = embedText(conti.fullText || conti.scenarioSummary || '');
      const pastEmb = await loadPastEmbeddings(accountId, historyId);
      const sim = computeSimilarityScores(embedding, pastEmb);
      similarityScore = sim.max;

      await logContiSimilarityDebug({
        accountId,
        historyId,
        workspace,
        pastEmbCount: pastEmb.length,
        scores: sim.scores,
        maxScore: sim.max,
        textLen: (conti.fullText || conti.scenarioSummary || '').length,
      });

      if (similarityScore < SIMILARITY_THRESHOLD) break;

      await logOperation({
        level: 'warn',
        message:
          `[video-content] 유사도 ${similarityScore.toFixed(3)} ≥ ${SIMILARITY_THRESHOLD} — 경고 후 검토 대기로 진행 history=${historyId}`,
        workspace,
        account_id: accountId,
      });
      await notifyTelegram(
        `⚠️ 콘티 유사도 경고\n계정: ${accountName} (${accountId})\n유사도 ${similarityScore.toFixed(3)} — 시나리오 검토 권장`,
        workspace,
      );
      break;
    }

    await assertContiProgress();

    let evoPrompt = '';

    for (let lengthAttempt = 0; lengthAttempt <= MAX_PROMPT_LENGTH_RETRIES; lengthAttempt++) {
      evoPrompt = buildEvoLinkPrompt(conti!, baseConditions);

      if (isEvoLinkPromptWithinLimit(evoPrompt)) break;

      if (lengthAttempt === MAX_PROMPT_LENGTH_RETRIES) {
        await supabase
          .from('huma_video_content_history')
          .update({
            status: 'on_hold',
            similarity_score: similarityScore,
            scenario_summary: conti!.scenarioSummary,
            location_keyword: conti!.locationKeyword,
            time_of_day: conti!.timeOfDay,
            conti_json: { ...conti, evolinkPrompt: evoPrompt, evolinkPromptLength: evoPrompt.length },
            embedding_vector: embedding,
            error_message: `프롬프트 길이 초과 (${evoPrompt.length}자 / 최대 ${EVOLINK_PROMPT_MAX_LENGTH}자)`,
            conti_generation_sec: contiGenSec(),
          })
          .eq('id', historyId);

        await notifyTelegram(
          `영상 콘티 프롬프트 길이 초과 — 계정: ${accountId}, 생성된 길이: ${evoPrompt.length}자`,
          workspace,
        );
        throw new Error('프롬프트 길이 초과');
      }

      const lengthFeedback = `${PROMPT_LENGTH_REGENERATION_FEEDBACK} (현재 변환 프롬프트 ${evoPrompt.length}자)`;
      const regenerated = await runPunchlineContiStage3Only({
        workspace,
        plan,
        pastSummaries,
        punchlineIdea,
        mustIncludeProps,
        feedback: lengthFeedback,
        onStage: logStage,
      });

      conti = regenerated.conti;
      embedding = embedText(conti.fullText || conti.scenarioSummary || '');
      const pastEmbAfterLength = await loadPastEmbeddings(accountId, historyId);
      const simAfterLength = computeSimilarityScores(embedding, pastEmbAfterLength);
      similarityScore = simAfterLength.max;
      await logContiSimilarityDebug({
        accountId,
        historyId,
        workspace,
        pastEmbCount: pastEmbAfterLength.length,
        scores: simAfterLength.scores,
        maxScore: simAfterLength.max,
        textLen: (conti.fullText || conti.scenarioSummary || '').length,
      });
    }

    await assertContiProgress();
    await logOperation({
      level: 'info',
      message: `[video-content] 유머 평가 — history=${historyId}`,
      workspace,
      account_id: accountId,
    });

    const selfAssessedHumor = await assessContiHumor(conti!);
    const retryCountForHumor = 0;

    if (selfAssessedHumor === 'funny') {
      await logOperation({
        level: 'info',
        message: `[video-content] 유머 평가 funny — history=${historyId}`,
        workspace,
        account_id: accountId,
      });
    } else {
      await logOperation({
        level: 'warn',
        message: `[video-content] 유머 dull — conti_ready (재생성 없음) — history=${historyId}`,
        workspace,
        account_id: accountId,
      });
    }

    await assertContiProgress();

    const storedCharacterNames = extractCharacterNamesForStorage(conti!, baseConditions.characterName);

    await supabase
      .from('huma_video_content_history')
      .update({
        status: 'conti_ready',
        location_keyword: conti!.locationKeyword,
        time_of_day: conti!.timeOfDay,
        scenario_summary: conti!.scenarioSummary,
        punchline_idea: punchlineIdea,
        hook_subtype: baseConditions.hookSubtype,
        conti_json: {
          ...conti,
          evolinkPrompt: evoPrompt,
          punchlineIdea,
          mustIncludeProps,
          storyDraft: conti!.storyDraft,
        },
        embedding_vector: embedding,
        similarity_score: similarityScore,
        self_assessed_humor: selfAssessedHumor,
        retry_count_for_humor: retryCountForHumor,
        character_names: storedCharacterNames.length ? storedCharacterNames : null,
        error_message: null,
        conti_generation_sec: contiGenSec(),
      })
      .eq('id', historyId);

    if (storedCharacterNames.length) {
      const recentNames = await loadRecentCharacterNames(accountId, historyId);
      const reused = storedCharacterNames.filter((name) => recentNames.includes(name));
      if (reused.length) {
        await logOperation({
          level: 'warn',
          message:
            `[video-content] 등장인물 이름 재사용 — ${reused.join(', ')} (최근 ${recentNames.length}건 이력과 겹침)`,
          workspace,
          account_id: accountId,
        });
      }
    }

    await logOperation({
      level: 'info',
      message: `[video-content] 콘티 검토 대기 — history=${historyId}`,
      workspace,
      account_id: accountId,
    });

    return historyId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stackHint =
      err instanceof Error && err.stack
        ? err.stack.split('\n').slice(1, 4).join(' | ')
        : '';
    const isContiValidation = err instanceof ContiValidationError;
    const isCancelled = err instanceof VideoContentCancelledError;
    const isExpectedVideoContentOutcome =
      isContiValidation ||
      msg === '프롬프트 길이 초과' ||
      err instanceof ContiGenerationBudgetExceeded ||
      isCancelled;
    const outcomeLabel =
      isContiValidation && err.holdOnFailure
        ? '보류'
        : isExpectedVideoContentOutcome
          ? '종료'
          : '생성 실패';
    await logOperation({
      level: isExpectedVideoContentOutcome ? 'warn' : 'ERROR',
      message: `[video-content] 콘티 ${outcomeLabel} — ${msg}${stackHint ? ` (${stackHint})` : ''}`,
      workspace,
      account_id: accountId,
    });
    if (
      !isCancelled &&
      msg !== '프롬프트 길이 초과' &&
      !(err instanceof ContiGenerationBudgetExceeded)
    ) {
      await supabase
        .from('huma_video_content_history')
        .update({ status: 'failed', error_message: msg.slice(0, 500), conti_generation_sec: contiGenSec() })
        .eq('id', historyId);
    } else if (err instanceof ContiGenerationBudgetExceeded) {
      await supabase
        .from('huma_video_content_history')
        .update({ status: 'failed', error_message: msg.slice(0, 500), conti_generation_sec: contiGenSec() })
        .eq('id', historyId);
    }
    throw err;
  }
}

/** 2단계 — 검토된 콘티 → EvoLink 영상 제작 */
export async function runVideoProduction(historyId: string): Promise<string> {
  if (!process.env.EVOLINK_API_KEY?.trim()) {
    throw new Error('EVOLINK_API_KEY 없음');
  }

  const { data: history, error: histErr } = await supabase
    .from('huma_video_content_history')
    .select('*')
    .eq('id', historyId)
    .maybeSingle();

  if (histErr || !history) throw new Error('히스토리 없음');

  const accountId = history.account_id as string;
  let accountName = accountId.slice(0, 8);
  let workspace: Workspace = history.workspace as Workspace;
  let wasCompletedRerender = false;

  try {
    if (!['conti_ready', 'rendering', 'completed'].includes(String(history.status))) {
      throw new Error(`영상 제작 불가 상태: ${history.status}`);
    }
    if (!history.conti_json) throw new Error('콘티 데이터 없음');

    wasCompletedRerender = history.status === 'completed';

    const { data: account } = await supabase
      .from('huma_accounts')
      .select('id, name, workspace')
      .eq('id', accountId)
      .maybeSingle();
    if (!account) throw new Error('계정 없음');
    accountName = account.name;
    workspace = account.workspace as Workspace;

    const parsedConti = parseContiFromJson(history.conti_json);
    const baseConditions = conditionsFromHistoryRow(history, history.character_used as string | null);
    const contiJson = history.conti_json as Record<string, unknown>;
    const { conti: timedConti, adjusted: timingAdjusted } = enforceDialogueShotsMinDuration(parsedConti);
    const conti = mergeShotTimingKeepDialogue(timedConti, parsedConti);
    if (timingAdjusted) {
      await logOperation({
        level: 'info',
        message: `[video-content] 렌더 전 샷 시간 재배분(대사 유지) — history=${historyId}`,
        workspace,
        account_id: accountId,
      });
    }
    const evoPrompt = buildEvoLinkPrompt(conti, baseConditions);
    if (!isEvoLinkPromptWithinLimit(evoPrompt)) {
      throw new Error(`EvoLink 프롬프트 길이 초과 (${evoPrompt.length}자)`);
    }

    if (history.status === 'conti_ready' || history.status === 'completed') {
      await supabase
        .from('huma_video_content_history')
        .update({ status: 'rendering', error_message: null })
        .eq('id', historyId);
    }

    const { videoQuality } = await getPipelineModelSettings(workspace);

    await logOperation({
      level: 'info',
      message: `[video-content] EvoLink Kling 3 Turbo ${videoQuality} 요청 — ${baseConditions.duration}초 history=${historyId}`,
      workspace,
      account_id: accountId,
    });

    const taskId = await createEvoLinkVideoTask({
      prompt: evoPrompt,
      duration: baseConditions.duration,
      quality: videoQuality,
    });

    await logOperation({
      level: 'info',
      message: `[video-content] EvoLink task=${taskId} — 폴링 시작 history=${historyId}`,
      workspace,
      account_id: accountId,
    });

    await supabase
      .from('huma_video_content_history')
      .update({
        status: 'rendering',
        error_message: null,
        conti_json: {
          ...contiJson,
          ...(timingAdjusted ? { shots: conti.shots, duration: conti.duration } : {}),
          evolinkPrompt: evoPrompt,
          evolinkTaskId: taskId,
          videoRenderStartedAt:
            typeof contiJson.videoRenderStartedAt === 'string' && contiJson.videoRenderStartedAt.trim()
              ? contiJson.videoRenderStartedAt
              : new Date().toISOString(),
        },
      })
      .eq('id', historyId);

    let sourcePath: string;
    let pollCompleted = false;
    try {
      await assertVideoContentNotCancelled(historyId);
      const videoUrl = await pollEvoLinkVideoUrl(taskId, {
        onPoll: async () => {
          await assertVideoContentNotCancelled(historyId);
        },
      });
      pollCompleted = true;
      await logOperation({
        level: 'info',
        message: `[video-content] EvoLink 완료 — 다운로드 시작 history=${historyId}`,
        workspace,
        account_id: accountId,
      });
      sourcePath = await downloadEvoLinkVideoToPath({ videoUrl, historyId });
    } catch (dlErr) {
      const msg = (dlErr as Error).message;
      if (dlErr instanceof VideoContentCancelledError) {
        throw dlErr;
      }
      if (!pollCompleted) {
        const reason = isEvoLinkPollTimeoutError(msg)
          ? msg
          : wasCompletedRerender
            ? `EvoLink 영상 생성 실패 — 기존 완료 영상 유지: ${msg.slice(0, 200)}`
            : `EvoLink 영상 생성 실패 — 검토 대기로 복구: ${msg.slice(0, 200)}`;
        await revertVideoRenderToContiReady(historyId, reason, {
          restoreCompleted: wasCompletedRerender,
        });
        await logOperation({
          level: 'warn',
          message: `[video-content] ${reason} — history=${historyId}`,
          workspace,
          account_id: accountId,
        });
        throw dlErr;
      }
      await revertVideoRenderToContiReady(historyId, `EvoLink 다운로드 실패: ${msg.slice(0, 200)}`, {
        restoreCompleted: wasCompletedRerender,
      });
      if (!wasCompletedRerender) {
        await handleEvoLinkDownloadFailure({
          accountId,
          workspace,
          accountName,
          historyId,
          error: msg,
        });
      }
      throw dlErr;
    }

    await finalizeVideoContent({
      historyId,
      accountId,
      accountName,
      workspace,
      conti,
      baseConditions,
      sourcePath,
      contiJson,
    });

    return historyId;
  } catch (err) {
    const msg = (err as Error).message;
    if (err instanceof VideoContentCancelledError) {
      throw err;
    }
    if (!msg.includes('EvoLink')) {
      if (wasCompletedRerender) {
        await revertVideoRenderToContiReady(historyId, msg.slice(0, 500), { restoreCompleted: true });
      } else {
        await supabase
          .from('huma_video_content_history')
          .update({ status: 'failed', error_message: msg })
          .eq('id', historyId);
      }
    }
    throw err;
  }
}

/** @deprecated 레거시 큐 — 콘티 생성만 수행 */
export async function runVideoContentGeneration(accountId: string): Promise<string> {
  return runContiGeneration(accountId);
}

export async function executeVideoContentGenerate(payload: { historyId?: string; accountId: string }) {
  if (payload.historyId) {
    await runVideoProduction(payload.historyId);
    return;
  }
  await runContiGeneration(payload.accountId);
}

export { finalizeVideoContent };
