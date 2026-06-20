import axios from 'axios';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { downloadFile, sleep } from '../../lib/utils.js';
import { notifyTelegram } from '../watcher/telegram.js';
import { logOperation } from '../../lib/log-emitter.js';
import { enqueueJob } from '../queue/producer.js';
import type { VideoConti } from './types.js';
import type { GenerationConditions } from './types.js';
import { buildSixShotTimeline, scaleSixShotDurations } from './shot-timing.js';
import { assertEvoLinkPromptLength } from './prompt-length.js';

export {
  EVOLINK_PROMPT_MAX_LENGTH,
  EVOLINK_PROMPT_LENGTH_GUIDANCE,
  isEvoLinkPromptWithinLimit,
  MAX_PROMPT_LENGTH_RETRIES,
  PROMPT_LENGTH_REGENERATION_FEEDBACK,
} from './prompt-length.js';

const API_BASE = process.env.EVOLINK_API_BASE?.trim() || 'https://api.evolink.ai';
const MODEL = 'kling-v3-turbo-text-to-video';

function apiKey(): string {
  const key = process.env.EVOLINK_API_KEY?.trim();
  if (!key) throw new Error('EVOLINK_API_KEY 없음');
  return key;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${apiKey()}`,
    'Content-Type': 'application/json',
  };
}

function callbackUrl(): string | undefined {
  const base = process.env.HUMA_SERVER_URL?.trim() || process.env.HUMA_API_PUBLIC_URL?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/$/, '')}/api/evolink/video-callback`;
}

function charBlock(conti: VideoConti): string {
  return conti.characters
    .map((c) => `${c.label}: ${c.age} ${c.gender}, ${c.hair}, ${c.outfit}, ${c.shoes}`)
    .join('; ');
}

function shotWords(shot: VideoConti['shots'][number], maxLen = 500): string {
  const parts = [`${shot.camera}`, shot.action];
  if (shot.dialogue?.trim()) parts.push(`대사: "${shot.dialogue.trim()}"`);
  return parts.join('. ').slice(0, maxLen);
}

/**
 * EvoLink Kling 3.0 Turbo 멀티샷 프롬프트 문법:
 * `镜头 n, m, words;` — n=샷번호(1~6), m=해당 샷 길이(초), 합계=duration
 */
export function buildEvoLinkMultiShotPrompt(conti: VideoConti, duration: number): string {
  const scene = `세로 9:16, ${conti.location}, ${conti.lighting}, ${conti.timeOfDay}. 등장인물(고정): ${charBlock(conti)}. 한국어 대사·자연스러운 오디오.`;
  const durations = scaleSixShotDurations(duration);
  const shots = conti.shots.slice(0, 6);

  while (shots.length < 6) {
    shots.push({
      shotNumber: shots.length + 1,
      startSec: 0,
      endSec: 0,
      camera: '미디엄',
      action: '장면 전개',
    });
  }

  const segments = durations.map((sec, i) => {
    const words = shotWords(shots[i]!);
    return `镜头 ${i + 1}, ${sec}, ${words}`;
  });

  const prompt = `${scene} ${segments.join('; ')};`;
  return prompt;
}

/** single_shot — 镜头 문법 없이 연속 숏 묘사 */
export function buildEvoLinkSingleShotPrompt(conti: VideoConti, conditions: GenerationConditions): string {
  const charDesc = charBlock(conti);
  const beats = conti.shots
    .map(
      (s) =>
        `[${s.startSec}-${s.endSec}s] ${s.camera}: ${s.action}${s.dialogue ? ` — "${s.dialogue}"` : ''}`,
    )
    .join(' ');

  const prompt = `Vertical 9:16, ${conditions.duration}s single continuous take, no cuts. Korean dialogue with natural audio. Location: ${conti.location}. Lighting: ${conti.lighting}. Time: ${conti.timeOfDay}. Characters (fixed): ${charDesc}. Timeline: ${beats}. Cinematic realistic mobile framing.`;
  return prompt;
}

export function buildEvoLinkPrompt(conti: VideoConti, conditions: GenerationConditions): string {
  if (conditions.cutType === 'multi_shot') {
    return buildEvoLinkMultiShotPrompt(conti, conditions.duration);
  }
  return buildEvoLinkSingleShotPrompt(conti, conditions);
}

type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface TaskDetail {
  id: string;
  status: TaskStatus;
  results?: string[];
  error?: { message?: string };
}

export async function createEvoLinkVideoTask(params: {
  prompt: string;
  duration: number;
  quality?: '720p' | '1080p';
}): Promise<string> {
  assertEvoLinkPromptLength(params.prompt);
  const body: Record<string, unknown> = {
    model: MODEL,
    prompt: params.prompt,
    duration: params.duration,
    aspect_ratio: '9:16',
    quality: params.quality ?? '720p',
  };
  const cb = callbackUrl();
  if (cb) body.callback_url = cb;

  const { data } = await axios.post<{ id: string }>(`${API_BASE}/v1/videos/generations`, body, {
    headers: authHeaders(),
    timeout: 60_000,
  });
  if (!data?.id) throw new Error('EvoLink task_id 없음');
  return data.id;
}

export async function getEvoLinkTask(taskId: string): Promise<TaskDetail> {
  const { data } = await axios.get<TaskDetail>(`${API_BASE}/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: authHeaders(),
    timeout: 30_000,
  });
  return data;
}

export async function pollEvoLinkVideoUrl(
  taskId: string,
  opts?: { maxWaitMs?: number; intervalMs?: number },
): Promise<string> {
  const maxWaitMs = opts?.maxWaitMs ?? 20 * 60 * 1000;
  const intervalMs = opts?.intervalMs ?? 5000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const task = await getEvoLinkTask(taskId);
    if (task.status === 'completed') {
      const url = task.results?.[0];
      if (!url) throw new Error('EvoLink 완료 응답에 영상 URL 없음');
      return url;
    }
    if (task.status === 'failed') {
      throw new Error(task.error?.message ?? 'EvoLink 영상 생성 실패');
    }
    await sleep(intervalMs);
  }
  throw new Error('EvoLink 영상 생성 시간 초과');
}

export async function downloadEvoLinkVideoToPath(params: {
  videoUrl: string;
  historyId: string;
}): Promise<string> {
  const tmpDir = join(process.cwd(), 'tmp', 'video-content', params.historyId);
  await mkdir(tmpDir, { recursive: true });
  return downloadFile(params.videoUrl, join(tmpDir, 'source.mp4'));
}

/** 다운로드 실패 시 Telegram + 재생성 큐 */
export async function handleEvoLinkDownloadFailure(params: {
  accountId: string;
  workspace: string;
  accountName: string;
  historyId: string;
  error: string;
}): Promise<void> {
  await notifyTelegram(
    `⚠️ EvoLink 영상 다운로드 실패 — 재생성 큐 등록\n계정: ${params.accountName}\n${params.error}`,
    params.workspace,
  );
  await logOperation({
    level: 'warn',
    message: `[evolink] 다운로드 실패 history=${params.historyId} — ${params.error}`,
    workspace: params.workspace,
    account_id: params.accountId,
  });
  await enqueueJob({
    type: 'video_content_generate',
    payload: { accountId: params.accountId, retryOf: params.historyId },
  });
}

/** LLM 콘티 shots를 6샷 타임라인에 맞게 정규화 */
export function normalizeMultiShotConti(conti: VideoConti, duration: number): VideoConti {
  const timeline = buildSixShotTimeline(duration);
  const src = conti.shots.length >= 6 ? conti.shots.slice(0, 6) : conti.shots;

  const shots = timeline.map((t, i) => {
    const fromLlm = src[i];
    return {
      shotNumber: t.shotNumber,
      startSec: t.startSec,
      endSec: t.endSec,
      camera: fromLlm?.camera ?? (i === 0 || i === 5 ? '와이드' : '클로즈업'),
      action: fromLlm?.action ?? '장면 전개',
      dialogue: fromLlm?.dialogue,
    };
  });

  return { ...conti, duration, cutType: 'multi_shot', shots };
}
