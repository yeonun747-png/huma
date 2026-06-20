import { copyFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Workspace } from '@huma/shared';
import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { getPipelineModelSettings } from '../../lib/pipeline-settings.js';
import { notifyTelegram } from '../watcher/telegram.js';
import { generatePlatformCaptions } from './captions.js';
import { generateConti } from './conti-generator.js';
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
  maxSimilarityToHistory,
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

async function loadPastEmbeddings(accountId: string): Promise<number[][]> {
  const { data } = await supabase
    .from('huma_video_content_history')
    .select('embedding_vector')
    .eq('account_id', accountId)
    .not('embedding_vector', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);
  return (data ?? [])
    .map((r) => r.embedding_vector as number[] | null)
    .filter((v): v is number[] => Array.isArray(v) && v.length > 0);
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

async function finalizeVideoContent(params: {
  historyId: string;
  accountId: string;
  accountName: string;
  workspace: Workspace;
  conti: VideoConti;
  baseConditions: Omit<GenerationConditions, 'locationKeyword' | 'timeOfDay'>;
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

export async function runVideoContentGeneration(accountId: string): Promise<string> {
  if (!process.env.EVOLINK_API_KEY?.trim()) {
    throw new Error('EVOLINK_API_KEY 없음');
  }

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

  const { data: historyRow, error: insertErr } = await supabase
    .from('huma_video_content_history')
    .insert({
      account_id: accountId,
      workspace,
      status: 'generating',
      relationship_axis: baseConditions.relationshipAxis,
      situation_axis: baseConditions.situationAxis ?? null,
      emotion_curve: baseConditions.emotionCurve,
      hook_type: baseConditions.hookType,
      cut_type: baseConditions.cutType,
      duration: baseConditions.duration,
      character_used: characterId ?? null,
    })
    .select('id')
    .single();

  if (insertErr || !historyRow) throw new Error(insertErr?.message ?? '히스토리 생성 실패');
  const historyId = historyRow.id as string;

  try {
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

      const generated = await generateConti({
        workspace,
        config: personaConfig,
        conditions,
        feedback,
        pastSummaries,
      });

      conditions.locationKeyword = generated.locationKeyword;
      conditions.timeOfDay = generated.timeOfDay;
      conti = generated;

      embedding = embedText(conti.fullText || conti.scenarioSummary);
      const pastEmb = await loadPastEmbeddings(accountId);
      similarityScore = maxSimilarityToHistory(embedding, pastEmb);

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
          `⚠️ 영상 콘티 생성 실패 — 유사도 기준 미통과\n계정: ${account.name} (${accountId})`,
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
        config: personaConfig,
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
    }

    await supabase
      .from('huma_video_content_history')
      .update({
        location_keyword: conti!.locationKeyword,
        time_of_day: conti!.timeOfDay,
        scenario_summary: conti!.scenarioSummary,
        conti_json: { ...conti, evolinkPrompt: evoPrompt },
        embedding_vector: embedding,
        similarity_score: similarityScore,
      })
      .eq('id', historyId);

    const { videoQuality } = await getPipelineModelSettings(workspace);

    const taskId = await createEvoLinkVideoTask({
      prompt: evoPrompt,
      duration: baseConditions.duration,
      quality: videoQuality,
    });

    await supabase
      .from('huma_video_content_history')
      .update({
        conti_json: { ...conti, evolinkPrompt: evoPrompt, evolinkTaskId: taskId },
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
      conti: conti!,
      baseConditions,
      sourcePath,
    });

    return historyId;
  } catch (err) {
    const msg = (err as Error).message;
    if (
      msg !== '유사도 기준 미통과' &&
      msg !== '프롬프트 길이 초과' &&
      !msg.includes('EvoLink')
    ) {
      await supabase
        .from('huma_video_content_history')
        .update({ status: 'failed', error_message: msg })
        .eq('id', historyId);
    }
    throw err;
  }
}

export async function executeVideoContentGenerate(payload: { historyId?: string; accountId: string }) {
  await runVideoContentGeneration(payload.accountId);
}

export { finalizeVideoContent };
