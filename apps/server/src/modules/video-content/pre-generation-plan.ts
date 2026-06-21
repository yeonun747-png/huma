import type { Workspace } from '@huma/shared';
import { supabase } from '../../middleware/auth.js';
import {
  extractAxisOptions,
  extractHookMechanisms,
  extractHookSubtypes,
} from './persona-axis.js';
import { pickFromOptions, pickFromOptionsWithFallback, pickDuration } from './selection.js';
import { loadVideoPersonaText } from './video-persona-store.js';
import { pickYeonunProduct, type YeonunProductPick } from './yeonun-product-picker.js';
import { pickPananaCharacter } from './panana-characters.js';
import { pickQuizContent, type QuizContentPick } from './quiz-content-cache.js';
import type { GenerationConditions } from './types.js';

type HistoryRow = {
  relationship_axis?: string | null;
  situation_axis?: string | null;
  emotion_curve?: string | null;
  hook_type?: string | null;
  hook_subtype?: string | null;
  duration?: number | null;
};

export interface PreGenerationPlan {
  personaText: string;
  conditions: GenerationConditions & { hookSubtype: string };
  yeonunProduct?: YeonunProductPick;
  quizContent?: QuizContentPick;
}

async function loadRecentHistoryByWorkspace(workspace: Workspace, limit: number): Promise<HistoryRow[]> {
  const { data } = await supabase
    .from('huma_video_content_history')
    .select('relationship_axis, situation_axis, emotion_curve, hook_type, hook_subtype, duration')
    .eq('workspace', workspace)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as HistoryRow[];
}

function pickHookSubtype(options: string[], recentValues: string[]): string {
  if (!options.length) return '';
  const recentThree = recentValues.slice(0, 3);
  const pool = options.filter(Boolean);
  if (!pool.length) return '';

  if (Math.random() >= 0.85) return pool[Math.floor(Math.random() * pool.length)]!;

  const avoid = new Set(recentThree.filter(Boolean));
  const candidates = pool.filter((o) => !avoid.has(o));
  if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)]!;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export async function buildPreGenerationPlan(params: {
  workspace: Workspace;
  accountId: string;
}): Promise<PreGenerationPlan> {
  const personaText = await loadVideoPersonaText(params.workspace);
  const recent = await loadRecentHistoryByWorkspace(params.workspace, 5);
  const recentSubtypes = (await loadRecentHistoryByWorkspace(params.workspace, 10)).map(
    (r) => r.hook_subtype ?? '',
  );

  const relationshipOptions = extractAxisOptions(personaText, '관계축');
  const emotionOptions = extractAxisOptions(personaText, '감정곡선');
  const situationOptions = extractAxisOptions(personaText, '상황축');
  const hookMechanisms = extractHookMechanisms(personaText);
  const hookSubtypes = extractHookSubtypes(personaText);

  const recentAxes = recent.map((r) => r.relationship_axis ?? '');
  const recentSituations = recent.map((r) => r.situation_axis ?? '');
  const recentEmotions = recent.map((r) => r.emotion_curve ?? '');
  const recentHooks = recent.map((r) => r.hook_type ?? '');
  const recentDurations = recent.map((r) => Number(r.duration) || 0);

  let characterId: string | undefined;
  let characterName: string | undefined;
  let characterDescription: string | undefined;

  if (params.workspace === 'panana') {
    const ch = await pickPananaCharacter(params.accountId);
    if (ch) {
      characterId = ch.id;
      characterName = ch.name;
      characterDescription = ch.description ?? undefined;
    }
  }

  let yeonunProduct: YeonunProductPick | undefined;
  if (params.workspace === 'yeonun') {
    yeonunProduct = (await pickYeonunProduct()) ?? undefined;
  }

  let quizContent: QuizContentPick | undefined;
  if (params.workspace === 'quizoasis') {
    quizContent = (await pickQuizContent()) ?? undefined;
  }

  const relationshipAxis = pickFromOptionsWithFallback(relationshipOptions, recentAxes, relationshipOptions);
  const emotionCurve = pickFromOptionsWithFallback(emotionOptions, recentEmotions, emotionOptions);
  const hookType = pickFromOptionsWithFallback(hookMechanisms, recentHooks, hookMechanisms);
  const hookSubtype = pickHookSubtype(hookSubtypes, recentSubtypes);
  const situationAxis =
    params.workspace === 'panana' && situationOptions.length
      ? pickFromOptionsWithFallback(situationOptions, recentSituations, situationOptions)
      : undefined;

  const conditions: GenerationConditions & { hookSubtype: string } = {
    relationshipAxis,
    situationAxis,
    emotionCurve,
    hookType,
    hookSubtype,
    locationKeyword: '',
    timeOfDay: '',
    cutType: 'multi_shot',
    duration: pickDuration(recentDurations),
    characterId,
    characterName,
    characterDescription,
  };

  return { personaText, conditions, yeonunProduct, quizContent };
}

export { pickFromOptions };
