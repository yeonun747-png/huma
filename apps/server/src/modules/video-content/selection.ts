import type { Workspace } from '@huma/shared';
import {
  filterValidHookTypeOptions,
  filterValidPersonaOptions,
  sanitizeHookTypeOptions,
  splitHookTypeGuidanceFromOptions,
} from '@huma/shared';
import { supabase } from '../../middleware/auth.js';
import { ensureScreenTextRenderingInConstraints } from './screen-text-constraint.js';
import {
  DEFAULT_VIDEO_PERSONAS,
  DURATION_OPTIONS,
  SUBTITLE_BOX_STYLES,
  SUBTITLE_FONTS,
  SUBTITLE_POSITIONS,
  SUBTITLE_TIMINGS,
  type GenerationConditions,
  type SubtitleStyle,
  type VideoPersonaConfig,
} from './types.js';

type HistoryRow = {
  relationship_axis?: string | null;
  situation_axis?: string | null;
  emotion_curve?: string | null;
  hook_type?: string | null;
  cut_type?: string | null;
  duration?: number | null;
};

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

export function pickHookType(
  config: VideoPersonaConfig,
  recentHooks: string[],
  fallbackHookTypes: string[] = [],
): string {
  const options = filterValidHookTypeOptions(sanitizeHookTypeOptions(config.hookTypes));
  const pool = options.length ? options : filterValidHookTypeOptions(fallbackHookTypes);
  if (!pool.length) return '';

  const forceRandom = Math.random() >= 0.85;
  if (forceRandom) return randomPick(pool);

  const recentSet = new Set(recentHooks.filter(Boolean));
  let candidates = pool.filter((o) => !recentSet.has(o));
  if (!candidates.length) candidates = [...pool];

  // 제한 가중치 적용 (예: 클리프행어 20% 이하)
  const weights = candidates.map((hook) => {
    const maxW = config.hookTypeMaxWeight?.[hook];
    if (maxW == null) return 1;
    const recentCount = recentHooks.filter((h) => h === hook).length;
    const ratio = recentCount / Math.max(recentHooks.length, 1);
    return ratio >= maxW ? 0.1 : 1;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

export function pickCutType(_recentCutTypes: string[]): 'single_shot' | 'multi_shot' {
  return 'multi_shot';
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

export async function loadRecentHistory(accountId: string, limit = 10): Promise<HistoryRow[]> {
  const { data } = await supabase
    .from('huma_video_content_history')
    .select('relationship_axis, situation_axis, emotion_curve, hook_type, cut_type, duration')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as HistoryRow[];
}

export function resolveVideoPersona(
  workspace: Workspace,
  personaJson: Record<string, unknown> | null | undefined,
): VideoPersonaConfig {
  const defaults = DEFAULT_VIDEO_PERSONAS[workspace];
  const custom = personaJson?.videoPersona as Partial<VideoPersonaConfig> | undefined;
  if (!custom) return defaults;

  const hookSplit = splitHookTypeGuidanceFromOptions(
    custom.hookTypes?.length ? custom.hookTypes : defaults.hookTypes,
    custom.hookTypeGuidance ?? defaults.hookTypeGuidance,
  );
  const hookTypes = hookSplit.hookTypes.length ? hookSplit.hookTypes : defaults.hookTypes;

  return {
    ...defaults,
    ...custom,
    relationshipAxes: filterValidPersonaOptions(
      custom.relationshipAxes?.length ? custom.relationshipAxes : defaults.relationshipAxes,
    ),
    situationAxes: filterValidPersonaOptions(
      custom.situationAxes?.length ? custom.situationAxes : defaults.situationAxes,
    ),
    emotionCurves: filterValidPersonaOptions(
      custom.emotionCurves?.length ? custom.emotionCurves : defaults.emotionCurves,
    ),
    hookTypes: filterValidHookTypeOptions(hookTypes.length ? hookTypes : defaults.hookTypes),
    hookTypeGuidance: hookSplit.hookTypeGuidance || defaults.hookTypeGuidance,
    hookTypeMaxWeight: custom.hookTypeMaxWeight ?? defaults.hookTypeMaxWeight,
    cutTypeRule: custom.cutTypeRule?.trim() ? custom.cutTypeRule : defaults.cutTypeRule,
    shotStructure: custom.shotStructure?.trim() ? custom.shotStructure : defaults.shotStructure,
    singleShotStructure: custom.singleShotStructure?.trim() || undefined,
    serviceConstraints: ensureScreenTextRenderingInConstraints(
      custom.serviceConstraints?.trim() ? custom.serviceConstraints : defaults.serviceConstraints,
    ),
  };
}

export async function buildGenerationConditions(params: {
  accountId: string;
  workspace: Workspace;
  personaConfig: VideoPersonaConfig;
  characterId?: string;
  characterName?: string;
  characterDescription?: string;
}): Promise<Omit<GenerationConditions, 'locationKeyword' | 'timeOfDay'>> {
  const recent = await loadRecentHistory(params.accountId, 5);
  const recentAxes = recent.map((r) => r.relationship_axis ?? '');
  const recentSituations = recent.map((r) => r.situation_axis ?? '');
  const recentEmotions = recent.map((r) => r.emotion_curve ?? '');
  const recentHooks = recent.map((r) => r.hook_type ?? '');
  const recentCuts = recent.map((r) => r.cut_type ?? '');
  const recentDurations = recent.map((r) => Number(r.duration) || 0);

  const defaults = DEFAULT_VIDEO_PERSONAS[params.workspace];

  const situationOptions = params.personaConfig.situationAxes ?? [];
  const situationAxis =
    params.workspace === 'panana' && situationOptions.length > 0
      ? pickFromOptionsWithFallback(situationOptions, recentSituations, defaults.situationAxes ?? [])
      : undefined;

  return {
    relationshipAxis: pickFromOptionsWithFallback(
      params.personaConfig.relationshipAxes,
      recentAxes,
      defaults.relationshipAxes,
    ),
    situationAxis,
    emotionCurve: pickFromOptionsWithFallback(
      params.personaConfig.emotionCurves,
      recentEmotions,
      defaults.emotionCurves,
    ),
    hookType: pickHookType(params.personaConfig, recentHooks, defaults.hookTypes),
    cutType: pickCutType(recentCuts),
    duration: pickDuration(recentDurations),
    characterId: params.characterId,
    characterName: params.characterName,
    characterDescription: params.characterDescription,
  };
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
