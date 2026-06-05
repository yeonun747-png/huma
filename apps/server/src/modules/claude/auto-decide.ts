import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getSetting } from '../../lib/settings.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';
import { getHiggsfieldCredits } from '../higgsfield/client.js';
import { isHaikuSubEnabled, isHiggsfieldVideoEnabled } from '../../lib/human-engine-policy.js';
import type { ContentType } from '@huma/shared';

export type PlatformScheduleKey = 'naver_blog' | 'tiktok' | 'instagram' | 'threads' | 'x';

export type PlatformSchedule = Record<PlatformScheduleKey, string>;

export interface AutoDecideResult {
  content_type: ContentType;
  video_model: string;
  schedule: PlatformSchedule;
}

const HAIKU_FALLBACK = 'claude-haiku-4-5-20251001';

const DEFAULT_SCHEDULE: PlatformSchedule = {
  naver_blog: '09:00',
  tiktok: '19:30',
  instagram: '10:00',
  threads: '08:30',
  x: '09:15',
};

export function toTodayDatetime(timeStr?: string): string | undefined {
  if (!timeStr) return undefined;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return undefined;
  const dt = new Date();
  dt.setSeconds(0, 0);
  dt.setHours(h, m, 0, 0);
  if (dt.getTime() <= Date.now()) dt.setDate(dt.getDate() + 1);
  return dt.toISOString();
}

/** v3.26 — Imagen 4 Fast 기본, generateImage()에서 프롬프트 기반 Haiku 판단 */
export function selectImageModel(_workspace: string): string {
  return 'imagen-4.0-fast-generate-001';
}

function spreadScheduleTime(timeStr: string, spreadMinutes: number): string {
  const [h, m] = timeStr.split(':').map(Number);
  const variance = Math.floor(Math.random() * spreadMinutes * 2) - spreadMinutes;
  const totalMin = h * 60 + m + variance;
  const nh = Math.floor(((totalMin % (24 * 60)) + 24 * 60) % (24 * 60) / 60);
  const nm = ((totalMin % 60) + 60) % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function randomTimeInWindow(start: string, end: string): string {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const pick = startMin + Math.floor(Math.random() * Math.max(1, endMin - startMin));
  return `${String(Math.floor(pick / 60)).padStart(2, '0')}:${String(pick % 60).padStart(2, '0')}`;
}

interface OptimalScheduleConfig {
  naver_blog?: { windows: Array<{ start: string; end: string }> };
  tiktok?: { windows: Array<{ start: string; end: string }> };
  instagram?: { windows: Array<{ start: string; end: string }> };
  threads?: { windows: Array<{ start: string; end: string }> };
  x?: { windows: Array<{ start: string; end: string }> };
  spread_minutes?: number;
}

export async function buildScheduleFromSettings(): Promise<PlatformSchedule> {
  const config = await getSetting<OptimalScheduleConfig>('optimal_schedule', {
    naver_blog: { windows: [{ start: '08:00', end: '10:00' }, { start: '19:00', end: '21:00' }] },
    tiktok: { windows: [{ start: '19:00', end: '21:00' }] },
    instagram: { windows: [{ start: '09:00', end: '11:00' }] },
    threads: { windows: [{ start: '08:00', end: '10:00' }] },
    x: { windows: [{ start: '09:00', end: '10:00' }] },
    spread_minutes: 30,
  });

  const spread = config.spread_minutes ?? 30;
  const schedule = { ...DEFAULT_SCHEDULE };

  for (const key of Object.keys(schedule) as PlatformScheduleKey[]) {
    const platform = config[key];
    const windows = platform?.windows ?? [];
    if (windows.length) {
      const win = windows[Math.floor(Math.random() * windows.length)];
      schedule[key] = spreadScheduleTime(randomTimeInWindow(win.start, win.end), spread);
    }
  }

  return schedule;
}

function fallbackAutoDecide(workspace: string, remainingCredits: number): AutoDecideResult {
  const content_type: ContentType = remainingCredits >= 50 && workspace !== 'quizoasis' ? 'B' : 'A';
  const video_model =
    workspace === 'yeonun' || workspace === 'panana' ? 'seedance-2.0' : 'kling-3.0';

  return {
    content_type,
    video_model,
    schedule: { ...DEFAULT_SCHEDULE },
  };
}

function enforceCreditRules(decision: AutoDecideResult, remainingCredits: number): AutoDecideResult {
  if (remainingCredits < 50 && decision.content_type === 'B') {
    return { ...decision, content_type: 'A' };
  }
  return decision;
}

/** v3.26 §7-3 · ㉞ — 기본 영상 모델은 Kling 3.0 또는 Seedance 2.0 (15초) */
function normalizeVideoModel(raw: string, workspace: string, _credits: number): string {
  const allowed = ['seedance-2.0', 'kling-3.0'];
  if (allowed.includes(raw)) return raw;
  if (workspace === 'yeonun' || workspace === 'panana') return 'seedance-2.0';
  return 'kling-3.0';
}

export async function autoDecide(params: {
  title: string;
  urlSummary: string;
  workspace: string;
  remainingCredits: number;
}): Promise<AutoDecideResult> {
  const higgsfieldOn = await isHiggsfieldVideoEnabled();
  const effectiveCredits = higgsfieldOn ? params.remainingCredits : 0;

  if (!(await isHaikuSubEnabled()) || !process.env.ANTHROPIC_API_KEY) {
    const fallback = await buildScheduleFromSettings();
    return enforceCreditRules(
      { ...fallbackAutoDecide(params.workspace, effectiveCredits), schedule: fallback },
      effectiveCredits,
    );
  }

  try {
    const optimal = await getSetting<OptimalScheduleConfig>('optimal_schedule', {});
    const raw = await askClaudeWithModel({
      model: (await getSubClaudeModel()) || HAIKU_FALLBACK,
      max_tokens: 300,
      prompt: `콘텐츠 제목: ${params.title}
내용 요약: ${params.urlSummary.slice(0, 300)}
서비스: ${params.workspace}
잔여 Higgsfield 크레딧: ${effectiveCredits}

아래 기준으로 JSON 결정 (JSON만, 설명 없이):

content_type 결정 기준:
  B (영상 포함): 감성·스토리·서비스소개·캐릭터·신규출시 → Higgsfield Cloud 크레딧 50개 이상 (Kling 15초=24크레딧)
  A (이미지만):  정보성·공지·이벤트안내·크레딧 50개 미만 (이미지는 Google Imagen, Higgsfield 크레딧 불필요)

video_model 결정 기준 (둘 중 하나만):
  "seedance-2.0": 연운·파나나 감성 콘텐츠 ($1.25/15초)
  "kling-3.0":    퀴즈오아시스 또는 비용 우선 ($1.20/15초, 24크레딧)

schedule (오늘 기준 최적 시간, 플랫폼별 분산):
  naver_blog: ${JSON.stringify(optimal.naver_blog?.windows ?? [])}
  tiktok: ${JSON.stringify(optimal.tiktok?.windows ?? [])}
  instagram: ${JSON.stringify(optimal.instagram?.windows ?? [])}
  threads: ${JSON.stringify(optimal.threads?.windows ?? [])}
  x: ${JSON.stringify(optimal.x?.windows ?? [])}

{"content_type":"A or B","video_model":"모델명",
"schedule":{"naver_blog":"HH:MM","tiktok":"HH:MM","instagram":"HH:MM","threads":"HH:MM","x":"HH:MM"}}`,
    });

    if (!raw) throw new Error('autoDecide empty');

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as {
      content_type?: string;
      video_model?: string;
      schedule?: Partial<PlatformSchedule>;
    };

    const spreadMinutes = 15;
    const schedule = { ...(await buildScheduleFromSettings()), ...parsed.schedule } as PlatformSchedule;
    for (const platform of Object.keys(schedule) as PlatformScheduleKey[]) {
      schedule[platform] = spreadScheduleTime(schedule[platform], spreadMinutes);
    }

    const decision: AutoDecideResult = {
      content_type: parsed.content_type === 'A' ? 'A' : 'B',
      video_model: normalizeVideoModel(parsed.video_model ?? 'kling-3.0', params.workspace, effectiveCredits),
      schedule,
    };

    return enforceCreditRules(decision, effectiveCredits);
  } catch {
    const fallback = await buildScheduleFromSettings();
    return enforceCreditRules(
      { ...fallbackAutoDecide(params.workspace, effectiveCredits), schedule: fallback },
      effectiveCredits,
    );
  }
}

export async function autoDecideWithCredits(params: {
  title: string;
  urlSummary: string;
  workspace: string;
}): Promise<AutoDecideResult> {
  const credits = await getHiggsfieldCredits();
  return autoDecide({ ...params, remainingCredits: credits });
}

export function resolvePlatformScheduledAt(
  platform: PlatformScheduleKey,
  schedule: PlatformSchedule | undefined,
  fallback: string,
): string {
  const time = schedule?.[platform];
  return toTodayDatetime(time) ?? fallback;
}

export { getHiggsfieldCredits };
