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
  it('updates dialogue and timing by shotNumber', () => {
    const contiJson = {
      shots: [
        { shotNumber: 1, startSec: 0, endSec: 3, camera: '미디엄', action: 'A가 본다.', dialogue: 'A: "원본"' },
        { shotNumber: 2, startSec: 3, endSec: 6, camera: '클로즈', action: 'B가 말한다.', dialogue: '' },
      ],
    };

    const next = applyShotDialoguePatches(contiJson, [
      { shotNumber: 1, dialogue: 'A: "수정본"', action: 'A가 고개를 든다.', startSec: 0.2, endSec: 3.5 },
      { shotNumber: 2, dialogue: 'B: "추가"', action: 'B가 웃는다.' },
    ]);

    expect(next.shots).toEqual([
      { shotNumber: 1, startSec: 0.2, endSec: 3.5, camera: '미디엄', action: 'A가 고개를 든다.', dialogue: 'A: "수정본"' },
      { shotNumber: 2, startSec: 3, endSec: 6, camera: '클로즈', action: 'B가 웃는다.', dialogue: 'B: "추가"' },
    ]);
  });

  it('rejects invalid timing', () => {
    expect(() =>
      applyShotDialoguePatches(
        { shots: [{ shotNumber: 1, startSec: 0, endSec: 3, camera: '', action: '', dialogue: '' }] },
        [{ shotNumber: 1, dialogue: '', action: '', startSec: 5, endSec: 2 }],
      ),
    ).toThrow(/시작 시각/);
  });
});
