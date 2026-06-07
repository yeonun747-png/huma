/** 한글 자모 분해·조합 — human-typing-sim · korean-ime 공용 */

export const INITIALS = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

export const MEDIALS = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
] as const;

export const FINALS = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

export function isHangul(char: string): boolean {
  return /[\uac00-\ud7a3]/.test(char);
}

export function decomposeHangul(char: string): string[] {
  const code = char.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return [];
  const uni = code - 0xac00;
  const i = Math.floor(uni / 588);
  const m = Math.floor((uni % 588) / 28);
  const f = uni % 28;
  const jamos: string[] = [INITIALS[i]!, MEDIALS[m]!];
  if (f > 0) jamos.push(FINALS[f]!);
  return jamos;
}

export function recomposeHangul(jamos: string[]): string {
  if (jamos.length < 2) return jamos.join('');
  const i = INITIALS.indexOf(jamos[0] as (typeof INITIALS)[number]);
  const m = MEDIALS.indexOf(jamos[1] as (typeof MEDIALS)[number]);
  const f = jamos.length > 2 ? FINALS.indexOf(jamos[2] as (typeof FINALS)[number]) : 0;
  if (i < 0 || m < 0 || f < 0) return jamos.join('');
  return String.fromCharCode(0xac00 + i * 588 + m * 28 + f);
}

export function composePartialHangul(jamos: string[]): string {
  if (jamos.length === 0) return '';
  if (jamos.length === 1) return jamos[0]!;
  const composed = recomposeHangul(jamos);
  return composed || jamos.join('');
}

/** 완성형 한글 → 두벌식 자모 입력 순서 (복합 모음·겹받침 분해) */
export function hangulToJamoSequence(char: string): string[] {
  const jamos = decomposeHangul(char);
  if (jamos.length < 2) return jamos;

  const seq: string[] = [jamos[0]!, jamos[1]!];
  if (jamos.length > 2) seq.push(jamos[2]!);
  return seq;
}
