import {
  findAdjacentDuplicateShotIndices,
  findRawShotQualityIssues,
  isGenericDefaultAction,
  SHOT_CONTENT_MIN_CHARS,
  validateShotContent,
} from './conti-validation.js';
import {
  applyGenericActionNarrativeFallback,
  synthesizeConcreteShotAction,
} from './generic-action-fallback.js';
import type { StoryDraft } from './story-draft.js';
import type { VideoConti } from './types.js';
import { asContiShots } from './types.js';

const ADJACENT_DIFF_SUFFIX = ' 다른 각도·거리에서 같은 순간을 이어가며 장면이 전개된다.';

/** 인접 중복 샷 — LLM 없이 action·camera 미세 변경 */
export function fixAdjacentDuplicateShots(conti: VideoConti): VideoConti {
  let current = conti;
  for (let pass = 0; pass < 3; pass++) {
    const duplicates = findAdjacentDuplicateShotIndices(current);
    if (!duplicates.length) break;

    const shots = asContiShots(current.shots).map((shot, i) => {
      if (!duplicates.includes(i)) return shot;
      const camera = shot.camera?.includes('클로즈')
        ? '미디엄 샷'
        : shot.camera?.includes('와이드')
          ? '미디엄 클로즈'
          : '클로즈업';
      let action = (shot.action ?? '').trim();
      if (!action.endsWith('.')) action += '.';
      action = `${action}${ADJACENT_DIFF_SUFFIX}`.slice(0, 280);
      return { ...shot, camera, action };
    });
    current = { ...current, shots };
  }
  return current;
}

function fillEmptyOrGenericShots(
  conti: VideoConti,
  ctx: { storyDraft?: StoryDraft; scenarioSummary?: string },
): { conti: VideoConti; filled: number[] } {
  const narrativeProse = ctx.storyDraft?.narrativeProse;
  const scenarioSummary = ctx.scenarioSummary ?? conti.scenarioSummary;
  const shotCount = asContiShots(conti.shots).length;
  const filled: number[] = [];

  const shots = asContiShots(conti.shots).map((shot, i) => {
    const content = validateShotContent(shot, i + 1);
    const needsAction =
      !content.ok || isGenericDefaultAction(shot.action) || (shot.action?.trim().length ?? 0) < SHOT_CONTENT_MIN_CHARS;
    if (!needsAction) return shot;

    const action = synthesizeConcreteShotAction({
      shotIndex: i,
      shotCount,
      narrativeProse,
      scenarioSummary,
      dialogue: shot.dialogue,
    });
    if (action.length >= SHOT_CONTENT_MIN_CHARS && !isGenericDefaultAction(action)) {
      filled.push(shot.shotNumber ?? i + 1);
      return { ...shot, action };
    }
    return shot;
  });

  return { conti: { ...conti, shots }, filled };
}

/** P0/P1 — 샷 품질 보완 LLM 루프 대체 */
export function applyRuleBasedShotRecovery(params: {
  conti: VideoConti;
  storyDraft?: StoryDraft;
  scenarioSummary?: string;
}): { conti: VideoConti; warnings: string[] } {
  const warnings: string[] = [];
  const ctx = { storyDraft: params.storyDraft, scenarioSummary: params.scenarioSummary };

  let current = params.conti;

  const genericFallback = applyGenericActionNarrativeFallback(current, ctx);
  if (genericFallback.replacedShotNumbers.length) {
    warnings.push(
      `filler action — 3a narrative에서 action 자동 보완 (샷 ${genericFallback.replacedShotNumbers.join(', ')})`,
    );
    current = genericFallback.conti;
  }

  const filled = fillEmptyOrGenericShots(current, ctx);
  if (filled.filled.length) {
    warnings.push(`빈·filler 샷 narrative 합성 (샷 ${filled.filled.join(', ')})`);
    current = filled.conti;
  }

  current = fixAdjacentDuplicateShots(current);

  for (const issue of findRawShotQualityIssues(current)) {
    if (issue.kind === 'generic_action' || issue.kind === 'empty') {
      const synth = synthesizeConcreteShotAction({
        shotIndex: issue.index,
        shotCount: asContiShots(current.shots).length,
        narrativeProse: params.storyDraft?.narrativeProse,
        scenarioSummary: params.scenarioSummary ?? current.scenarioSummary,
        dialogue: asContiShots(current.shots)[issue.index]?.dialogue,
      });
      if (synth.length >= SHOT_CONTENT_MIN_CHARS) {
        const shots = [...asContiShots(current.shots)];
        shots[issue.index] = { ...shots[issue.index]!, action: synth };
        current = { ...current, shots };
      }
      continue;
    }
    warnings.push(`샷 ${issue.index + 1} ${issue.kind} — 검토 권장`);
  }

  return { conti: current, warnings };
}
