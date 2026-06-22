import { describe, expect, it } from 'vitest';
import { applyShotDialoguePatches, canEditContiDialogues } from './conti-dialogue-edit.js';

describe('canEditContiDialogues', () => {
  it('allows review and completed statuses', () => {
    expect(canEditContiDialogues('conti_ready')).toBe(true);
    expect(canEditContiDialogues('completed')).toBe(true);
    expect(canEditContiDialogues('rendering')).toBe(false);
  });
});

describe('applyShotDialoguePatches', () => {
  it('updates dialogue by shotNumber', () => {
    const contiJson = {
      shots: [
        { shotNumber: 1, startSec: 0, endSec: 3, camera: '미디엄', action: 'A가 본다.', dialogue: 'A: "원본"' },
        { shotNumber: 2, startSec: 3, endSec: 6, camera: '클로즈', action: 'B가 말한다.', dialogue: '' },
      ],
    };

    const next = applyShotDialoguePatches(contiJson, [
      { shotNumber: 1, dialogue: 'A: "수정본"' },
      { shotNumber: 2, dialogue: 'B: "추가"' },
    ]);

    expect(next.shots).toEqual([
      { shotNumber: 1, startSec: 0, endSec: 3, camera: '미디엄', action: 'A가 본다.', dialogue: 'A: "수정본"' },
      { shotNumber: 2, startSec: 3, endSec: 6, camera: '클로즈', action: 'B가 말한다.', dialogue: 'B: "추가"' },
    ]);
  });
});
