import { convertSpokenKoreanNumbers } from './korean-spoken-numbers.js';
import type { VideoConti } from './types.js';
import { asContiShots } from './types.js';

export function applySpokenKoreanNumbersToDialogue(dialogue: string): string {
  return convertSpokenKoreanNumbers(dialogue);
}

export function applySpokenKoreanNumbersToConti(conti: VideoConti): VideoConti {
  const shots = asContiShots(conti.shots).map((shot) => {
    const dialogue = shot.dialogue?.trim();
    if (!dialogue) return shot;
    const next = applySpokenKoreanNumbersToDialogue(dialogue);
    return next === dialogue ? shot : { ...shot, dialogue: next };
  });
  return { ...conti, shots };
}
