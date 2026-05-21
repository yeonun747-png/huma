import type { Page, Locator } from 'playwright';
import { gaussianRandom, randomBetween, sleep, wpmToDelay } from '../../lib/utils.js';
import type { HumanEngineConfig } from '../../lib/settings.js';

const ADJACENT: Record<string, string[]> = {
  a: ['s', 'q', 'w'],
  b: ['v', 'n', 'g'],
  c: ['x', 'v', 'd'],
  d: ['s', 'f', 'e'],
  e: ['w', 'r', 'd'],
  f: ['d', 'g', 'r'],
  g: ['f', 'h', 't'],
  h: ['g', 'j', 'y'],
  i: ['u', 'o', 'k'],
  j: ['h', 'k', 'u'],
  k: ['j', 'l', 'i'],
  l: ['k', 'o', 'p'],
  m: ['n', 'j', 'k'],
  n: ['b', 'm', 'h'],
  o: ['i', 'p', 'l'],
  p: ['o', 'l', '['],
  q: ['w', 'a', 's'],
  r: ['e', 't', 'f'],
  s: ['a', 'd', 'w'],
  t: ['r', 'y', 'g'],
  u: ['y', 'i', 'j'],
  v: ['c', 'b', 'f'],
  w: ['q', 'e', 's'],
  x: ['z', 'c', 's'],
  y: ['t', 'u', 'h'],
  z: ['x', 'a', 's'],
};

const DUBEOLSIK_ADJACENT: Record<string, string[]> = {
  'ㅂ': ['ㅈ', 'ㄱ'],
  'ㅈ': ['ㅂ', 'ㄷ'],
  'ㄷ': ['ㅈ', 'ㄱ', 'ㅅ'],
  'ㄱ': ['ㄷ', 'ㅅ'],
  'ㅅ': ['ㄱ', 'ㅛ', 'ㅎ'],
  'ㅛ': ['ㅅ', 'ㅕ', 'ㅍ'],
  'ㅕ': ['ㅛ', 'ㅓ'],
  'ㅓ': ['ㅕ', 'ㅏ'],
  'ㅏ': ['ㅓ', 'ㅣ'],
  'ㅣ': ['ㅏ'],
  'ㅁ': ['ㄴ', 'ㄹ'],
  'ㄴ': ['ㅁ', 'ㅇ'],
  'ㅇ': ['ㄴ', 'ㄹ', 'ㅎ'],
  'ㄹ': ['ㅁ', 'ㅇ', 'ㅎ'],
  'ㅎ': ['ㄹ', 'ㅗ'],
  'ㅗ': ['ㅎ', 'ㅜ', 'ㅐ'],
  'ㅜ': ['ㅗ', 'ㅔ'],
  'ㅐ': ['ㅗ', 'ㅔ'],
  'ㅔ': ['ㅜ', 'ㅐ'],
  'ㅋ': ['ㅌ'],
  'ㅌ': ['ㅋ', 'ㅊ'],
  'ㅊ': ['ㅌ', 'ㅍ'],
  'ㅍ': ['ㅊ', 'ㅛ'],
  'ㅑ': ['ㅏ', 'ㅣ'],
  'ㅒ': ['ㅐ', 'ㅔ'],
  'ㅖ': ['ㅔ', 'ㅒ'],
};

const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const MEDIALS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function decomposeHangul(char: string): string[] {
  const code = char.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return [];
  const uni = code - 0xac00;
  const i = Math.floor(uni / 588);
  const m = Math.floor((uni % 588) / 28);
  const f = uni % 28;
  const jamos = [INITIALS[i], MEDIALS[m]];
  if (f > 0) jamos.push(FINALS[f]);
  return jamos;
}

function recomposeHangul(jamos: string[]): string {
  if (jamos.length < 2) return jamos.join('');
  const i = INITIALS.indexOf(jamos[0]);
  const m = MEDIALS.indexOf(jamos[1]);
  const f = jamos.length > 2 ? FINALS.indexOf(jamos[2]) : 0;
  if (i < 0 || m < 0 || f < 0) return jamos.join('');
  return String.fromCharCode(0xac00 + i * 588 + m * 28 + f);
}

function getAdjacentKeyLatin(char: string): string {
  const lower = char.toLowerCase();
  const keys = ADJACENT[lower];
  if (!keys?.length) return char;
  return keys[Math.floor(Math.random() * keys.length)];
}

export function getAdjacentKeyKorean(char: string): string {
  const jamos = decomposeHangul(char);
  if (!jamos.length) return getAdjacentKeyLatin(char);

  const jamo = jamos[0];
  const neighbors = DUBEOLSIK_ADJACENT[jamo];
  if (!neighbors?.length) return char;

  const wrongJamo = neighbors[Math.floor(Math.random() * neighbors.length)];
  return recomposeHangul([wrongJamo, ...jamos.slice(1)]);
}

function getAdjacentKey(char: string): string {
  if (/[\uac00-\ud7a3]/.test(char)) return getAdjacentKeyKorean(char);
  return getAdjacentKeyLatin(char);
}

export async function humanType(
  page: Page,
  element: Locator,
  text: string,
  config: HumanEngineConfig
) {
  await element.click();
  for (const char of text) {
    if (Math.random() < config.typo_rate) {
      await element.pressSequentially(getAdjacentKey(char), { delay: 50 });
      await sleep(randomBetween(200, 500));
      await page.keyboard.press('Backspace');
      await sleep(randomBetween(...config.backspace_delay_ms));
    }
    await element.pressSequentially(char, { delay: 50 });
    await sleep(wpmToDelay(gaussianRandom(config.wpm_mean, config.wpm_sigma)));
  }
}

export async function humanSleep(minMs: number, maxMs: number) {
  await sleep(randomBetween(minMs, maxMs));
}
