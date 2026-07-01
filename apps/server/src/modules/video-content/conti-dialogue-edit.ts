import { asContiShots } from './types.js';

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
        { dialogue: String(p.dialogue ?? '').trim(), action: String(p.action ?? '').trim() },
      ]),
  );

  const nextShots = shots.map((shot, index) => {
    const shotNumber = shot.shotNumber > 0 ? shot.shotNumber : index + 1;
    const patch = byNumber.get(shotNumber);
    if (!patch) return shot;
    return { ...shot, dialogue: patch.dialogue, action: patch.action };
  });

  return { ...contiJson, shots: nextShots };
}
