import axios from 'axios';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { downloadFile, sleep } from '../../lib/utils.js';
import { notifyTelegram } from '../watcher/telegram.js';
import { logOperation } from '../../lib/log-emitter.js';
import { enqueueJob } from '../queue/producer.js';
import type { VideoConti, VideoContiShot, GenerationConditions } from './types.js';
import {
  EVOLINK_MAX_SHOTS,
  resolveMultiShotCount,
  buildMultiShotTimeline,
} from './shot-timing.js';
import { isInvalidShotContentField, findPunchlineShotIndex } from './conti-validation.js';
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

function shotDurationSec(shot: VideoContiShot): number {
  const d = shot.endSec - shot.startSec;
  return d > 0 ? d : 0;
}

/**
 * EvoLink Kling 3.0 Turbo 멀티샷 프롬pt 문법:
 * `镜头 n, m, words;` — n=샷번호, m=해당 샷 길이(초), 합계=duration
 */
export function buildEvoLinkMultiShotPrompt(conti: VideoConti, duration: number): string {
  const scene = `세로 9:16, ${conti.location}, ${conti.lighting}, ${conti.timeOfDay}. 등장인물(고정): ${charBlock(conti)}. 한국어 대사·자연스러운 오디오.`;
  const shots = conti.shots.slice(0, EVOLINK_MAX_SHOTS);

  const segments = shots.map((shot, i) => {
    const sec = Math.max(1, Math.round(shotDurationSec(shot) || duration / Math.max(shots.length, 1)));
    const words = shotWords(shot);
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
    type: 'video_content_render',
    payload: { historyId: params.historyId },
  });
}

function mapSourceShotIndex(slotIndex: number, slotCount: number, sourceCount: number): number {
  if (sourceCount <= 0) return 0;
  if (sourceCount >= slotCount) return slotIndex;
  return Math.min(sourceCount - 1, Math.floor((slotIndex * sourceCount) / slotCount));
}

function findLastSubstantiveAction(src: VideoContiShot[]): string | null {
  for (let i = src.length - 1; i >= 0; i--) {
    const action = src[i]?.action?.trim() ?? '';
    if (action && !isInvalidShotContentField(action)) return action;
  }
  return null;
}

function defaultSlotAction(slotIndex: number, totalSlots: number): string {
  if (slotIndex === 0) {
    return '와이드 샷. 상황과 인물 관계가 드러나며 이야기를 시작한다.';
  }
  if (slotIndex === totalSlots - 1) {
    return '와이드 샷. 여운을 남기며 장면이 자연스럽게 마무리된다.';
  }
  if (slotIndex === totalSlots - 2 && totalSlots >= 3) {
    return '클로즈업. 감정이 고조되며 펀치라인 직전의 순간이 포착된다.';
  }
  return '미디엄/클로즈업. 행동과 반응이 이어지며 장면이 전개된다.';
}

function defaultCamera(slotIndex: number, totalSlots: number): string {
  if (slotIndex === 0 || slotIndex === totalSlots - 1) return '와이드';
  return '클로즈업';
}

/** 검증 실패 시 최후 폴백 action (conti-generator에서 사용) */
export function getDefaultShotAction(slotIndex: number, totalSlots = EVOLINK_MAX_SHOTS): string {
  return defaultSlotAction(slotIndex, totalSlots);
}

function resolveSlotAction(slotIndex: number, totalSlots: number, src: VideoContiShot[]): string {
  const mapped = src[mapSourceShotIndex(slotIndex, totalSlots, src.length)];
  const action = mapped?.action?.trim() ?? '';
  if (action && !isInvalidShotContentField(action)) {
    if (slotIndex === totalSlots - 1 && src.length < totalSlots) {
      return `와이드 샷. ${action.slice(0, 50)} 장면이 멀어지며 여운 있게 마무리된다.`;
    }
    return action;
  }

  const borrowed = findLastSubstantiveAction(src);
  if (borrowed) {
    if (slotIndex === totalSlots - 1) {
      return `와이드 샷. ${borrowed.slice(0, 50)} 장면이 멀어지며 여운 있게 마무리된다.`;
    }
    return borrowed;
  }

  return defaultSlotAction(slotIndex, totalSlots);
}

function countSubstantiveShots(src: VideoContiShot[]): number {
  const substantive = src.filter(
    (s) =>
      (s.action?.trim() && !isInvalidShotContentField(s.action)) || Boolean(s.dialogue?.trim()),
  ).length;
  return Math.max(substantive, src.length);
}

/** LLM 샷 수(4~6)를 유지하며 타임라인·최소 길이만 정규화 — 6슬롯 강제 없음 */
export function normalizeMultiShotConti(conti: VideoConti, duration: number): VideoConti {
  const src = conti.shots.length > 0 ? conti.shots : [];
  const shotCount = resolveMultiShotCount(countSubstantiveShots(src), duration);
  const timeline = buildMultiShotTimeline(duration, shotCount);

  const shots = timeline.map((t, i) => {
    const mapped = src[mapSourceShotIndex(i, shotCount, src.length)];
    const action = resolveSlotAction(i, shotCount, src);
    return {
      shotNumber: t.shotNumber,
      startSec: t.startSec,
      endSec: t.endSec,
      camera: mapped?.camera?.trim() || defaultCamera(i, shotCount),
      action,
      dialogue: mapped?.dialogue,
    };
  });

  return { ...conti, duration, cutType: 'multi_shot', shots };
}

function mergeSingleShotAction(src: VideoContiShot[], duration: number): string {
  if (src.length <= 1) {
    return src[0]?.action?.trim() || getDefaultShotAction(0, 1);
  }
  return src
    .map((s, i) => {
      const start = s.startSec ?? 0;
      const end =
        s.endSec > start ? s.endSec : i < src.length - 1 ? (src[i + 1]?.startSec ?? duration) : duration;
      const action = s.action?.trim() ?? '';
      return action ? `[${start}~${end}초] ${action}` : '';
    })
    .filter(Boolean)
    .join(' → ');
}

function pickSingleShotDialogue(src: VideoContiShot[]): string | undefined {
  const idx = findPunchlineShotIndex(src);
  const fromPunchline = idx >= 0 ? src[idx]?.dialogue?.trim() : '';
  if (fromPunchline) return fromPunchline;
  for (let i = src.length - 1; i >= 0; i--) {
    const d = src[i]?.dialogue?.trim();
    if (d) return d;
  }
  return undefined;
}

/** LLM이 N>1 샷을 반환해도 1샷으로 병합 — single_shot 정의 강제 */
export function normalizeSingleShotConti(
  conti: VideoConti,
  duration: number,
): { conti: VideoConti; merged: boolean } {
  const src = conti.shots.length > 0 ? conti.shots : [];
  const merged = src.length > 1;

  if (src.length <= 1) {
    const base = src[0];
    const action =
      base?.action?.trim() && !isInvalidShotContentField(base.action)
        ? base.action.trim()
        : getDefaultShotAction(0, 1);
    return {
      conti: {
        ...conti,
        duration,
        cutType: 'single_shot',
        shots: [
          {
            shotNumber: 1,
            startSec: 0,
            endSec: duration,
            camera: '고정 샷',
            action,
            dialogue: base?.dialogue?.trim() || undefined,
          },
        ],
      },
      merged: false,
    };
  }

  const action = mergeSingleShotAction(src, duration);
  const dialogue = pickSingleShotDialogue(src);

  return {
    conti: {
      ...conti,
      duration,
      cutType: 'single_shot',
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: duration,
          camera: '고정 샷',
          action,
          dialogue,
        },
      ],
    },
    merged,
  };
}
