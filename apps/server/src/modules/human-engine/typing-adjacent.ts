import { decomposeHangul, isHangul, recomposeHangul } from './hangul.js';

const ADJACENT: Record<string, string[]> = {
  a: ['s', 'q', 'w'], b: ['v', 'n', 'g'], c: ['x', 'v', 'd'], d: ['s', 'f', 'e'],
  e: ['w', 'r', 'd'], f: ['d', 'g', 'r'], g: ['f', 'h', 't'], h: ['g', 'j', 'y'],
  i: ['u', 'o', 'k'], j: ['h', 'k', 'u'], k: ['j', 'l', 'i'], l: ['k', 'o', 'p'],
  m: ['n', 'j', 'k'], n: ['b', 'm', 'h'], o: ['i', 'p', 'l'], p: ['o', 'l', '['],
  q: ['w', 'a', 's'], r: ['e', 't', 'f'], s: ['a', 'd', 'w'], t: ['r', 'y', 'g'],
  u: ['y', 'i', 'j'], v: ['c', 'b', 'f'], w: ['q', 'e', 's'], x: ['z', 'c', 's'],
  y: ['t', 'u', 'h'], z: ['x', 'a', 's'],
};

const DUBEOLSIK_ADJACENT: Record<string, string[]> = {
  'ㅂ': ['ㅈ', 'ㄱ'], 'ㅈ': ['ㅂ', 'ㄷ'], 'ㄷ': ['ㅈ', 'ㄱ', 'ㅅ'], 'ㄱ': ['ㄷ', 'ㅅ'],
  'ㅅ': ['ㄱ', 'ㅛ', 'ㅎ'], 'ㅛ': ['ㅅ', 'ㅕ', 'ㅍ'], 'ㅕ': ['ㅛ', 'ㅓ'], 'ㅓ': ['ㅕ', 'ㅏ'],
  'ㅏ': ['ㅓ', 'ㅣ'], 'ㅣ': ['ㅏ'], 'ㅁ': ['ㄴ', 'ㄹ'], 'ㄴ': ['ㅁ', 'ㅇ'],
  'ㅇ': ['ㄴ', 'ㄹ', 'ㅎ'], 'ㄹ': ['ㅁ', 'ㅇ', 'ㅎ'], 'ㅎ': ['ㄹ', 'ㅗ'],
  'ㅗ': ['ㅎ', 'ㅜ', 'ㅐ'], 'ㅜ': ['ㅗ', 'ㅔ'], 'ㅐ': ['ㅗ', 'ㅔ'], 'ㅔ': ['ㅜ', 'ㅐ'],
  'ㅋ': ['ㅌ'], 'ㅌ': ['ㅋ', 'ㅊ'], 'ㅊ': ['ㅌ', 'ㅍ'], 'ㅍ': ['ㅊ', 'ㅛ'],
};

function pickWrong(original: string, neighbors: string[] | undefined): string {
  if (!neighbors?.length) return original;
  const pool = neighbors.filter((n) => n !== original);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)]! : neighbors[0]!;
}

function getAdjacentKeyLatin(char: string): string {
  return pickWrong(char.toLowerCase(), ADJACENT[char.toLowerCase()]) || char;
}

export function getAdjacentKeyKorean(char: string): string {
  const jamos = decomposeHangul(char);
  if (!jamos.length) return getAdjacentKeyLatin(char);
  const wrongInitial = pickWrong(jamos[0]!, DUBEOLSIK_ADJACENT[jamos[0]!]);
  return recomposeHangul([wrongInitial, ...jamos.slice(1)]);
}

export function getAdjacentKey(char: string): string {
  if (isHangul(char)) return getAdjacentKeyKorean(char);
  return getAdjacentKeyLatin(char);
}
