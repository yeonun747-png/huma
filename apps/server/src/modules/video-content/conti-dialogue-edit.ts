import { asContiShots } from './types.js';
import type { VideoConti } from './types.js';
import { applySpokenKoreanNumbersToDialogue } from './conti-spoken-numbers.js';

export function parseVideoContiFromJson(raw: unknown): VideoConti {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    characters: (obj.characters as VideoConti['characters']) ?? [],
    location: String(obj.location ?? ''),
    lighting: String(obj.lighting ?? ''),
    timeOfDay: String(obj.timeOfDay ?? ''),
    cutType: obj.cutType === 'single_shot' ? 'single_shot' : 'multi_shot',
    duration: Number(obj.duration) > 0 ? Number(obj.duration) : 15,
    shots: asContiShots(obj.shots),
    scenarioSummary: String(obj.scenarioSummary ?? ''),
    fullText: String(obj.fullText ?? obj.scenarioSummary ?? ''),
  };
}

export const EDITABLE_CONTI_DIALOGUE_STATUSES = [
  'conti_ready',
  'on_hold',
  'failed',
  'completed',
] as const;

export type EditableContiDialogueStatus = (typeof EDITABLE_CONTI_DIALOGUE_STATUSES)[number];

export function canEditContiDialogues(status: string): status is EditableContiDialogueStatus {
  return (EDITABLE_CONTI_DIALOGUE_STATUSES as readonly string[]).includes(status);
}

export interface ShotDialoguePatch {
  shotNumber: number;
  dialogue: string;
  action: string;
  startSec?: number;
  endSec?: number;
}

function normalizeDialogueField(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function patchShotTiming(
  shot: { shotNumber: number; startSec: number; endSec: number },
  patch: Pick<ShotDialoguePatch, 'startSec' | 'endSec'>,
): { startSec: number; endSec: number } {
  let startSec = shot.startSec;
  let endSec = shot.endSec;
  if (patch.startSec !== undefined && Number.isFinite(patch.startSec)) {
    startSec = Math.max(0, patch.startSec);
  }
  if (patch.endSec !== undefined && Number.isFinite(patch.endSec)) {
    endSec = Math.max(0, patch.endSec);
  }
  if (startSec >= endSec) {
    throw new Error(`샷 ${shot.shotNumber}: 시작 시각(${startSec}s)은 끝(${endSec}s)보다 작아야 합니다`);
  }
  return { startSec, endSec };
}

/** 자막 reburn — UI에서 전달된 멘트가 있으면 저장본 대신 해당 패치 적용 */
export function resolveContiJsonForSubtitleBurn(
  contiJson: Record<string, unknown>,
  dialogues?: ShotDialoguePatch[],
): Record<string, unknown> {
  if (!dialogues?.length) return contiJson;
  return applyShotDialoguePatches(contiJson, dialogues);
}

export function applyShotDialoguePatches(
  contiJson: Record<string, unknown>,
  patches: ShotDialoguePatch[],
): Record<string, unknown> {
  const shots = asContiShots(contiJson.shots);
  if (!shots.length) {
    throw new Error('샷 데이터가 없습니다');
  }

  const byNumber = new Map(
    patches
      .filter((p) => Number.isFinite(p.shotNumber) && p.shotNumber > 0)
      .map((p) => [
        p.shotNumber,
        {
          dialogue: applySpokenKoreanNumbersToDialogue(normalizeDialogueField(p.dialogue)),
          action: String(p.action ?? '').trim(),
          startSec: p.startSec,
          endSec: p.endSec,
        },
      ]),
  );

  if (patches.length > 0 && byNumber.size === 0) {
    throw new Error('유효한 샷 번호가 없습니다');
  }

  let appliedPatchCount = 0;
  const nextShots = shots.map((shot, index) => {
    const shotNumber = shot.shotNumber > 0 ? shot.shotNumber : index + 1;
    const patch = byNumber.get(shotNumber);
    if (!patch) return shot;
    appliedPatchCount += 1;
    const timing = patchShotTiming(shot, patch);
    return { ...shot, dialogue: patch.dialogue, action: patch.action, ...timing };
  });

  if (patches.length > 0 && appliedPatchCount === 0) {
    throw new Error('멘트 패치가 어떤 샷에도 적용되지 않았습니다 (샷 번호 확인)');
  }

  return { ...contiJson, shots: nextShots };
}
