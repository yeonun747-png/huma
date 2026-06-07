/** 표준 두벌식 — fcitx-hangul / Windows 한글 키보드 */

export type KeyPress = { key: string; shift?: boolean };

const PLAIN: Record<string, KeyPress> = {
  'ㅂ': { key: 'q' }, 'ㅈ': { key: 'w' }, 'ㄷ': { key: 'e' }, 'ㄱ': { key: 'r' }, 'ㅅ': { key: 't' },
  'ㅛ': { key: 'y' }, 'ㅕ': { key: 'u' }, 'ㅑ': { key: 'i' }, 'ㅐ': { key: 'o' }, 'ㅔ': { key: 'p' },
  'ㅁ': { key: 'a' }, 'ㄴ': { key: 's' }, 'ㅇ': { key: 'd' }, 'ㄹ': { key: 'f' }, 'ㅎ': { key: 'g' },
  'ㅗ': { key: 'h' }, 'ㅓ': { key: 'j' }, 'ㅏ': { key: 'k' }, 'ㅣ': { key: 'l' },
  'ㅋ': { key: 'z' }, 'ㅌ': { key: 'x' }, 'ㅊ': { key: 'c' }, 'ㅍ': { key: 'v' },
  'ㅠ': { key: 'b' }, 'ㅜ': { key: 'n' }, 'ㅡ': { key: 'm' },
  'ㄲ': { key: 'r', shift: true }, 'ㄸ': { key: 'e', shift: true }, 'ㅃ': { key: 'q', shift: true },
  'ㅆ': { key: 't', shift: true }, 'ㅉ': { key: 'w', shift: true },
  'ㅒ': { key: 'o', shift: true }, 'ㅖ': { key: 'p', shift: true },
};

/** 복합 모음·겹받침 — 순차 키 입력 */
const SEQUENCES: Record<string, KeyPress[]> = {
  'ㅘ': [{ key: 'h' }, { key: 'k' }],
  'ㅙ': [{ key: 'h' }, { key: 'o' }],
  'ㅚ': [{ key: 'h' }, { key: 'l' }],
  'ㅝ': [{ key: 'n' }, { key: 'j' }],
  'ㅞ': [{ key: 'n' }, { key: 'p' }],
  'ㅟ': [{ key: 'n' }, { key: 'l' }],
  'ㅢ': [{ key: 'm' }, { key: 'l' }],
  'ㄳ': [{ key: 'r' }, { key: 't' }],
  'ㄵ': [{ key: 's' }, { key: 'w' }],
  'ㄶ': [{ key: 's' }, { key: 'g' }],
  'ㄺ': [{ key: 'f' }, { key: 'r' }],
  'ㄻ': [{ key: 'f' }, { key: 'a' }],
  'ㄼ': [{ key: 'f' }, { key: 'q' }],
  'ㄽ': [{ key: 'f' }, { key: 't' }],
  'ㄾ': [{ key: 'f' }, { key: 'x' }],
  'ㄿ': [{ key: 'f' }, { key: 'v' }],
  'ㅀ': [{ key: 'f' }, { key: 'g' }],
  'ㅄ': [{ key: 'q' }, { key: 't' }],
};

export function jamoToKeyPresses(jamo: string): KeyPress[] {
  if (SEQUENCES[jamo]) return SEQUENCES[jamo]!;
  const single = PLAIN[jamo];
  if (single) return [single];
  return [{ key: jamo }];
}
