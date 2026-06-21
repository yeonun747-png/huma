import type { Workspace } from '@huma/shared';
import { filterValidPersonaOptions } from '@huma/shared';
import { supabase } from '../../middleware/auth.js';
import { ensureScreenTextRenderingInConstraints } from './screen-text-constraint.js';
import {
  DURATION_OPTIONS,
  SUBTITLE_BOX_STYLES,
  SUBTITLE_FONTS,
  SUBTITLE_POSITIONS,
  SUBTITLE_TIMINGS,
  type SubtitleStyle,
} from './types.js';

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** 직전 N건 회피 + 0.85 난수 예외 */
export function pickFromOptions(options: string[], recentValues: string[], forceRandom = false): string {
  const pool = filterValidPersonaOptions(options);
  if (!pool.length) return '';
  if (forceRandom || Math.random() >= 0.85) return randomPick(pool);

  const recentSet = new Set(recentValues.filter(Boolean));
  const candidates = pool.filter((o) => !recentSet.has(o));
  if (candidates.length) return randomPick(candidates);

  for (const v of recentValues) {
    if (pool.includes(v)) return v;
  }
  return randomPick(pool);
}

export function pickFromOptionsWithFallback(
  options: string[],
  recentValues: string[],
  fallback: string[],
): string {
  const pool = filterValidPersonaOptions(options);
  const allowed = pool.length ? pool : filterValidPersonaOptions(fallback);
  if (!allowed.length) return '';
  return pickFromOptions(allowed, recentValues);
}

export function pickDuration(recentDurations: number[]): number {
  const recent = recentDurations.filter((d) => d > 0);
  const forceRandom = Math.random() >= 0.85;
  if (forceRandom) return randomPick([...DURATION_OPTIONS]);

  const recentSet = new Set(recent);
  const candidates = DURATION_OPTIONS.filter((d) => !recentSet.has(d));
  if (candidates.length) return randomPick(candidates);
  return randomPick([...DURATION_OPTIONS]);
}

export async function pickSubtitleStyle(accountId: string): Promise<SubtitleStyle> {
  const { data } = await supabase
    .from('huma_subtitle_style_history')
    .select('font, position, timing, box_style')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(5);

  const recent = (data ?? []) as SubtitleStyle[];
  const recentCombos = new Set(recent.map((r) => `${r.font}|${r.position}|${r.timing}|${r.boxStyle}`));

  for (let attempt = 0; attempt < 30; attempt++) {
    const style: SubtitleStyle = {
      font: randomPick(SUBTITLE_FONTS),
      position: randomPick(SUBTITLE_POSITIONS),
      timing: randomPick(SUBTITLE_TIMINGS),
      boxStyle: randomPick(SUBTITLE_BOX_STYLES),
    };
    const key = `${style.font}|${style.position}|${style.timing}|${style.boxStyle}`;
    if (!recentCombos.has(key)) return style;
  }

  return {
    font: randomPick(SUBTITLE_FONTS),
    position: randomPick(SUBTITLE_POSITIONS),
    timing: randomPick(SUBTITLE_TIMINGS),
    boxStyle: randomPick(SUBTITLE_BOX_STYLES),
  };
}

export async function saveSubtitleStyleHistory(accountId: string, style: SubtitleStyle): Promise<void> {
  await supabase.from('huma_subtitle_style_history').insert({
    account_id: accountId,
    font: style.font,
    position: style.position,
    timing: style.timing,
    box_style: style.boxStyle,
  });
}

/** @deprecated — huma_video_persona.personaText 경로만 사용. 시드용 DEFAULT_VIDEO_PERSONAS.serviceConstraints 보강 */
export function ensureWorkspaceServiceConstraints(constraints: string): string {
  return ensureScreenTextRenderingInConstraints(constraints);
}
