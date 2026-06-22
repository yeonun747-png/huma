import axios from 'axios';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { downloadFile, sleep } from '../../lib/utils.js';
import { notifyTelegram } from '../watcher/telegram.js';
import { logOperation } from '../../lib/log-emitter.js';
import { enqueueJob } from '../queue/producer.js';
import type { VideoConti, VideoContiShot, GenerationConditions } from './types.js';
import { asContiShots } from './types.js';
import {
  EVOLINK_MAX_SHOTS,
  resolveMultiShotCount,
  buildMultiShotTimeline,
  snapShotDurationsToTotal,
  normalizeVideoDurationSec,
  SHOT_TIMING_MIN_SEC,
} from './shot-timing.js';
import { isInvalidShotContentField, findPunchlineShotIndex, isGenericDefaultAction } from './conti-validation.js';
import {
  buildCharacterNameToLabelMap,
  formatEvoLinkCharacterBlock,
  normalizeShotForEvoLinkPrompt,
} from './character-labels.js';
import { assertEvoLinkPromptLength } from './prompt-length.js';

export {
  EVOLINK_PROMPT_MAX_LENGTH,
  EVOLINK_PROMPT_LENGTH_GUIDANCE,
  isEvoLinkPromptWithinLimit,
  MAX_PROMPT_LENGTH_RETRIES,
  PROMPT_LENGTH_REGENERATION_FEEDBACK,
} from './prompt-length.js';

const API_BASE = process.env.EVOLINK_API_BASE?.trim() || 'https://api.evolink.ai';
const MODEL =
  process.env.EVOLINK_VIDEO_MODEL?.trim() || 'kling-v3-turbo-text-to-video';

export function hasEvoLinkApiKey(): boolean {
  return Boolean(process.env.EVOLINK_API_KEY?.trim());
}

function formatEvoLinkAxiosError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    const nestedErr = data?.error;
    if (nestedErr && typeof nestedErr === 'object' && 'message' in nestedErr) {
      const msg = (nestedErr as { message?: string }).message;
      if (msg) return `EvoLink API: ${msg}`;
    }
    for (const key of ['message', 'detail', 'error'] as const) {
      const val = data?.[key];
      if (typeof val === 'string' && val.trim()) return `EvoLink API: ${val}`;
    }
    const status = err.response?.status;
    return status ? `EvoLink API HTTP ${status}: ${err.message}` : `EvoLink API: ${err.message}`;
  }
  return (err as Error).message ?? String(err);
}

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

function shotWords(
  shot: VideoConti['shots'][number],
  nameToLabel: Map<string, string>,
  maxLen = 500,
): string {
  const normalized = normalizeShotForEvoLinkPrompt(shot, nameToLabel);
  const parts = [`${shot.camera}`, normalized.action];
  if (normalized.dialogue) parts.push(`대사: "${normalized.dialogue}"`);
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
  const totalSec = normalizeVideoDurationSec(duration);
  const nameToLabel = buildCharacterNameToLabelMap(conti);
  const scene = `세로 9:16, ${conti.location}, ${conti.lighting}, ${conti.timeOfDay}. 등장인물(고정): ${formatEvoLinkCharacterBlock(conti, nameToLabel)}. 한국어 대사·자연스러운 오디오.`;
  const shots = asContiShots(conti.shots).slice(0, EVOLINK_MAX_SHOTS);
  const segmentSecs = snapShotDurationsToTotal(
    shots.map((shot) => shotDurationSec(shot)),
    totalSec,
    SHOT_TIMING_MIN_SEC,
  );

  const segments = shots.map((shot, i) => {
    const sec = segmentSecs[i] ?? SHOT_TIMING_MIN_SEC;
    const words = shotWords(shot, nameToLabel);
    return `镜头 ${i + 1}, ${sec}, ${words}`;
  });

  const prompt = `${scene} ${segments.join('; ')};`;
  return prompt;
}

/** single_shot — 镜头 문법 없이 연속 숏 묘사 */
export function buildEvoLinkSingleShotPrompt(conti: VideoConti, conditions: GenerationConditions): string {
  const nameToLabel = buildCharacterNameToLabelMap(conti);
  const charDesc = formatEvoLinkCharacterBlock(conti, nameToLabel);
  const beats = asContiShots(conti.shots)
    .map((s) => {
      const normalized = normalizeShotForEvoLinkPrompt(s, nameToLabel);
      return `[${s.startSec}-${s.endSec}s] ${s.camera}: ${normalized.action}${normalized.dialogue ? ` — "${normalized.dialogue}"` : ''}`;
    })
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

interface TaskDetail {
  id?: string;
  status?: string;
  results?: unknown[];
  output?: unknown;
  error?: { message?: string } | string;
}

function extractTaskId(data: Record<string, unknown>): string {
  const direct = data.id ?? data.task_id;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const nested = data.data;
  if (nested && typeof nested === 'object') {
    const n = nested as Record<string, unknown>;
    const inner = n.id ?? n.task_id;
    if (typeof inner === 'string' && inner.trim()) return inner.trim();
  }
  throw new Error('EvoLink task_id 없음');
}

function pickUrl(value: unknown): string | null {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const key of ['url', 'video_url', 'uri', 'download_url']) {
      const u = o[key];
      if (typeof u === 'string' && /^https?:\/\//i.test(u)) return u;
    }
  }
  return null;
}

/** GET /v1/tasks/{id} — results 배열·output 객체 모두 지원 */
export function extractVideoUrlFromTask(task: TaskDetail): string | null {
  if (Array.isArray(task.results)) {
    for (const item of task.results) {
      const url = pickUrl(item);
      if (url) return url;
    }
  }
  const fromOutput = pickUrl(task.output);
  if (fromOutput) return fromOutput;
  if (Array.isArray(task.output)) {
    for (const item of task.output) {
      const url = pickUrl(item);
      if (url) return url;
    }
  }
  return null;
}

function isTaskCompleted(status: string | undefined): boolean {
  return status === 'completed' || status === 'succeeded' || status === 'success';
}

function isTaskFailed(status: string | undefined): boolean {
  return status === 'failed' || status === 'error' || status === 'cancelled';
}

function taskErrorMessage(task: TaskDetail): string {
  if (typeof task.error === 'string') return task.error;
  return task.error?.message ?? 'EvoLink 영상 생성 실패';
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
    duration: normalizeVideoDurationSec(params.duration),
    aspect_ratio: '9:16',
    quality: params.quality ?? '720p',
  };
  const cb = callbackUrl();
  if (cb) body.callback_url = cb;

  try {
    const { data } = await axios.post<Record<string, unknown>>(
      `${API_BASE}/v1/videos/generations`,
      body,
      {
        headers: authHeaders(),
        timeout: 60_000,
      },
    );
    return extractTaskId(data ?? {});
  } catch (err) {
    throw new Error(formatEvoLinkAxiosError(err));
  }
}

export async function getEvoLinkTask(taskId: string): Promise<TaskDetail> {
  try {
    const { data } = await axios.get<TaskDetail>(
      `${API_BASE}/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        headers: authHeaders(),
        timeout: 30_000,
      },
    );
    return data;
  } catch (err) {
    throw new Error(formatEvoLinkAxiosError(err));
  }
}

export async function pollEvoLinkVideoUrl(
  taskId: string,
  opts?: { maxWaitMs?: number; intervalMs?: number; onPoll?: (task: TaskDetail) => void | Promise<void> },
): Promise<string> {
  const maxWaitMs = opts?.maxWaitMs ?? 20 * 60 * 1000;
  const intervalMs = opts?.intervalMs ?? 5000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const task = await getEvoLinkTask(taskId);
    await opts?.onPoll?.(task);
    const status = task.status;
    if (isTaskCompleted(status)) {
      const url = extractVideoUrlFromTask(task);
      if (!url) throw new Error('EvoLink 완료 응답에 영상 URL 없음');
      return url;
    }
    if (isTaskFailed(status)) {
      throw new Error(taskErrorMessage(task));
    }
    await sleep(intervalMs);
  }
  throw new Error('EvoLink 영상 생성 시간 초과 (20분)');
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
    if (action && !isInvalidShotContentField(action) && !isGenericDefaultAction(action)) return action;
  }
  return null;
}

/** conti 검증·거부 대상 — Kling/EvoLink 기본 filler action (콘티 저장 금지) */
export { GENERIC_DEFAULT_ACTION_PHRASES, isGenericDefaultAction } from './conti-validation.js';

function defaultSlotAction(slotIndex: number, totalSlots: number): string {
  if (slotIndex === 0) {
    return '두 인물과 공간 관계가 드러나며 상황을 소개한다.';
  }
  if (slotIndex === totalSlots - 1) {
    return '장면이 서서히 멀어지며 여운 있게 마무리된다.';
  }
  if (slotIndex === totalSlots - 2 && totalSlots >= 3) {
    return '감정이 고조되며 펀치라인 직전의 순간이 포착된다.';
  }
  return '행동과 반응이 이어지며 장면이 전개된다.';
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
  if (action && !isInvalidShotContentField(action) && !isGenericDefaultAction(action)) {
    if (slotIndex === totalSlots - 1 && src.length < totalSlots) {
      return `${action.slice(0, 50)} 장면이 멀어지며 여운 있게 마무리된다.`;
    }
    return action;
  }

  const borrowed = findLastSubstantiveAction(src);
  if (borrowed) {
    if (slotIndex === totalSlots - 1) {
      return `${borrowed.slice(0, 50)} 장면이 멀어지며 여운 있게 마무리된다.`;
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
  const srcShots = asContiShots(conti.shots);
  const src = srcShots.length > 0 ? srcShots : [];
  const totalSec = normalizeVideoDurationSec(duration);
  const shotCount = resolveMultiShotCount(countSubstantiveShots(src), totalSec);
  const timeline = buildMultiShotTimeline(totalSec, shotCount);

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

  return { ...conti, duration: totalSec, cutType: 'multi_shot', shots };
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
  const srcShots = asContiShots(conti.shots);
  const src = srcShots.length > 0 ? srcShots : [];
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
