import { copyFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Workspace } from '@huma/shared';
import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { getPipelineModelSettings } from '../../lib/pipeline-settings.js';
import { notifyTelegram } from '../watcher/telegram.js';
import { generatePlatformCaptions } from './captions.js';
import { generateConti } from './conti-generator.js';
import { ContiValidationError, formatContiTokenSettingsLog } from './conti-validation.js';
import {
  buildEvoLinkPrompt,
  createEvoLinkVideoTask,
  downloadEvoLinkVideoToPath,
  handleEvoLinkDownloadFailure,
  pollEvoLinkVideoUrl,
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
import { pickPananaCharacter } from './panana-characters.js';
import {
  buildGenerationConditions,
  pickSubtitleStyle,
  resolveVideoPersona,
  saveSubtitleStyleHistory,
} from './selection.js';
import { burnSubtitles } from './subtitle.js';
import type { GenerationConditions, VideoConti } from './types.js';

const WEB_BASE = process.env.HUMA_WEB_URL?.trim() || 'http://localhost:3000';

async function loadPastSummaries(accountId: string): Promise<string[]> {
  const { data } = await supabase
    .from('huma_video_content_history')
    .select('scenario_summary')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(10);
  return (data ?? []).map((r) => String(r.scenario_summary ?? '')).filter(Boolean);
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
  personaConfig: ReturnType<typeof resolveVideoPersona>;
  baseConditions: GenerationConditions;
}

async function loadVideoAccountContext(accountId: string): Promise<VideoAccountContext> {
  const { data: account, error: accErr } = await supabase
    .from('huma_accounts')
    .select('id, name, workspace, persona')
    .eq('id', accountId)
    .maybeSingle();

  if (accErr || !account) throw new Error('계정 없음');
  const workspace = account.workspace as Workspace;
  const personaConfig = resolveVideoPersona(workspace, account.persona as Record<string, unknown>);

  let characterId: string | undefined;
  let characterName: string | undefined;
  let characterDescription: string | undefined;

  if (workspace === 'panana') {
    const ch = await pickPananaCharacter(accountId);
    if (ch) {
      characterId = ch.id;
      characterName = ch.name;
      characterDescription = ch.description ?? undefined;
    }
  }

  const baseConditions = await buildGenerationConditions({
    accountId,
    workspace,
    personaConfig,
    characterId,
    characterName,
    characterDescription,
  });

  return {
    accountId,
    accountName: account.name,
    workspace,
    personaConfig,
    baseConditions,
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
}): Promise<void> {
  const { historyId, accountId, workspace, accountName, conti, baseConditions, sourcePath } = params;

  const tmpDir = join(process.cwd(), 'tmp', 'video-content', historyId);
  await mkdir(tmpDir, { recursive: true });

  const subtitleStyle = await pickSubtitleStyle(accountId);
  const subtitledPath = join(tmpDir, 'final.mp4');
  await burnSubtitles({
    inputVideoPath: sourcePath,
    outputVideoPath: subtitledPath,
    conti,
    style: subtitleStyle,
  });
  await saveSubtitleStyleHistory(accountId, subtitleStyle);

  const captions = await generatePlatformCaptions({
    workspace,
    conti,
    hookType: baseConditions.hookType,
    recentCaptions: await loadRecentCaptions(accountId),
  });

  const finalPath = join(process.cwd(), 'data', 'video-content', `${historyId}.mp4`);
  await mkdir(join(process.cwd(), 'data', 'video-content'), { recursive: true });
  await copyFile(subtitledPath, finalPath);

  await supabase
    .from('huma_video_content_history')
    .update({
      status: 'completed',
      video_file_path: finalPath,
      caption_youtube: captions.captionYoutube,
      caption_tiktok: captions.captionTiktok,
      caption_instagram: captions.captionInstagram,
      caption_threads: captions.captionThreads,
      caption_x: captions.captionX,
      first_comment_threads: captions.firstCommentThreads,
      first_comment_x: captions.firstCommentX,
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

/** 1단계 — Sonnet 콘티 생성 (관리자 검토 후 영상 제작) */
export async function runContiGeneration(accountId: string): Promise<string> {
  const ctx = await loadVideoAccountContext(accountId);
  const { baseConditions, workspace, accountName } = ctx;

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
      cut_type: baseConditions.cutType,
      duration: baseConditions.duration,
      character_used: baseConditions.characterId ?? null,
    })
    .select('id')
    .single();

  if (insertErr || !historyRow) throw new Error(insertErr?.message ?? '히스토리 생성 실패');
  const historyId = historyRow.id as string;

  try {
    await logOperation({
      level: 'info',
      message: formatContiTokenSettingsLog(),
      workspace,
      account_id: accountId,
    });

    const pastSummaries = await loadPastSummaries(accountId);
    let conti!: VideoConti & { locationKeyword: string; timeOfDay: string };
    let embedding: number[] = [];
    let similarityScore = 0;
    let feedback: string | undefined;

    for (let attempt = 1; attempt <= MAX_REGENERATION_ATTEMPTS; attempt++) {
      const conditions: GenerationConditions = {
        ...baseConditions,
        locationKeyword: '',
        timeOfDay: '',
      };

      let generated: Awaited<ReturnType<typeof generateConti>>;
      try {
        generated = await generateConti({
          workspace,
          config: ctx.personaConfig,
          conditions,
          feedback,
          pastSummaries,
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
                })
                .eq('id', historyId);
              const holdLabel =
                err.holdReason === 'empty_content'
                  ? '빈 액션/대사 검증 실패'
                  : err.holdReason === 'shot_duration'
                    ? '샷 길이 검증 실패'
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
                })
                .eq('id', historyId);
            }
            throw err;
          }
          continue;
        }
        throw err;
      }

      conditions.locationKeyword = generated.locationKeyword;
      conditions.timeOfDay = generated.timeOfDay;
      conti = generated;

      if (generated.contentWarnings?.length) {
        await notifyTelegram(
          `⚠️ 콘티 샷 자동 보완\n계정: ${accountName} (${accountId})\n${generated.contentWarnings.join('\n')}`,
          workspace,
        );
      }

      if (generated.lastShotIncompleteDetected) {
        await logOperation({
          level: 'warn',
          message:
            `[video-content] 마지막 샷 문장 미완결 감지 — max_tokens 부족 가능성. ${formatContiTokenSettingsLog()}`,
          workspace,
          account_id: accountId,
        });
      }

      embedding = embedText(conti.fullText || conti.scenarioSummary);
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
        textLen: (conti.fullText || conti.scenarioSummary).length,
      });

      if (similarityScore < SIMILARITY_THRESHOLD) break;

      feedback = `직전 시나리오와 코사인 유사도 ${similarityScore.toFixed(3)}으로 겹침. 완전히 다른 인물·장소·사건·대사로 재작성하라.`;
      if (attempt === MAX_REGENERATION_ATTEMPTS) {
        await supabase
          .from('huma_video_content_history')
          .update({
            status: 'failed',
            similarity_score: similarityScore,
            scenario_summary: conti.scenarioSummary,
            error_message: '유사도 기준 미통과 (3회)',
          })
          .eq('id', historyId);

        await notifyTelegram(
          `⚠️ 영상 콘티 생성 실패 — 유사도 기준 미통과\n계정: ${accountName} (${accountId})`,
          workspace,
        );
        throw new Error('유사도 기준 미통과');
      }
    }

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
          })
          .eq('id', historyId);

        await notifyTelegram(
          `영상 콘티 프롬프트 길이 초과 — 계정: ${accountId}, 생성된 길이: ${evoPrompt.length}자`,
          workspace,
        );
        throw new Error('프롬프트 길이 초과');
      }

      const lengthFeedback = `${PROMPT_LENGTH_REGENERATION_FEEDBACK} (현재 변환 프롬프트 ${evoPrompt.length}자)`;
      const regenerated = await generateConti({
        workspace,
        config: ctx.personaConfig,
        conditions: {
          ...baseConditions,
          locationKeyword: conti!.locationKeyword,
          timeOfDay: conti!.timeOfDay,
        },
        feedback: lengthFeedback,
        pastSummaries,
      });

      conti = regenerated;
      embedding = embedText(conti.fullText || conti.scenarioSummary);
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
        textLen: (conti.fullText || conti.scenarioSummary).length,
      });
    }

    await supabase
      .from('huma_video_content_history')
      .update({
        status: 'conti_ready',
        location_keyword: conti!.locationKeyword,
        time_of_day: conti!.timeOfDay,
        scenario_summary: conti!.scenarioSummary,
        conti_json: { ...conti, evolinkPrompt: evoPrompt },
        embedding_vector: embedding,
        similarity_score: similarityScore,
        error_message: null,
      })
      .eq('id', historyId);

    await notifyTelegram(
      `📝 콘티 검토 대기\n계정: ${accountName}\n${WEB_BASE}/video-content?id=${historyId}`,
      workspace,
    );

    return historyId;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg !== '유사도 기준 미통과' && msg !== '프롬프트 길이 초과') {
      await supabase
        .from('huma_video_content_history')
        .update({ status: 'failed', error_message: msg })
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
  if (history.status !== 'conti_ready') {
    throw new Error(`영상 제작 불가 상태: ${history.status}`);
  }
  if (!history.conti_json) throw new Error('콘티 데이터 없음');

  const accountId = history.account_id as string;
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('id, name, workspace')
    .eq('id', accountId)
    .maybeSingle();
  if (!account) throw new Error('계정 없음');

  const workspace = account.workspace as Workspace;
  const conti = parseContiFromJson(history.conti_json);
  const baseConditions = conditionsFromHistoryRow(history, history.character_used as string | null);
  const contiJson = history.conti_json as Record<string, unknown>;
  let evoPrompt = String(contiJson.evolinkPrompt ?? '');
  if (!evoPrompt) {
    evoPrompt = buildEvoLinkPrompt(conti, baseConditions);
  }
  if (!isEvoLinkPromptWithinLimit(evoPrompt)) {
    throw new Error(`EvoLink 프롬프트 길이 초과 (${evoPrompt.length}자)`);
  }

  await supabase
    .from('huma_video_content_history')
    .update({ status: 'rendering', error_message: null })
    .eq('id', historyId);

  try {
    const { videoQuality } = await getPipelineModelSettings(workspace);

    const taskId = await createEvoLinkVideoTask({
      prompt: evoPrompt,
      duration: baseConditions.duration,
      quality: videoQuality,
    });

    await supabase
      .from('huma_video_content_history')
      .update({
        conti_json: { ...contiJson, ...conti, evolinkPrompt: evoPrompt, evolinkTaskId: taskId },
      })
      .eq('id', historyId);

    let sourcePath: string;
    try {
      const videoUrl = await pollEvoLinkVideoUrl(taskId);
      sourcePath = await downloadEvoLinkVideoToPath({ videoUrl, historyId });
    } catch (dlErr) {
      const msg = (dlErr as Error).message;
      await supabase
        .from('huma_video_content_history')
        .update({ status: 'failed', error_message: `EvoLink 다운로드 실패: ${msg}` })
        .eq('id', historyId);
      await handleEvoLinkDownloadFailure({
        accountId,
        workspace,
        accountName: account.name,
        historyId,
        error: msg,
      });
      throw dlErr;
    }

    await finalizeVideoContent({
      historyId,
      accountId,
      accountName: account.name,
      workspace,
      conti,
      baseConditions,
      sourcePath,
    });

    return historyId;
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes('EvoLink')) {
      await supabase
        .from('huma_video_content_history')
        .update({ status: 'failed', error_message: msg })
        .eq('id', historyId);
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
