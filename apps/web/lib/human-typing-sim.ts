/** 브라우저용 — server human-engine/typing.ts · timing.ts 와 동일 로직 */

import { planParagraphPaste } from '@huma/shared';
import { calcReviewDurationMs } from '@/lib/review-duration';

export { calcReviewDurationMs };

export type HumanEngineSimConfig = {
  wpm_mean: number;
  wpm_sigma: number;
  typo_rate: number;
  backspace_delay_ms: [number, number];
  paragraph_pause_ms: [number, number];
  review_duration_ms: [number, number];
  paste_ratio?: number;
};

export const DEFAULT_HUMAN_ENGINE_SIM: HumanEngineSimConfig = {
  wpm_mean: 38,
  wpm_sigma: 18,
  typo_rate: 0.09,
  backspace_delay_ms: [200, 800],
  paragraph_pause_ms: [2000, 8000],
  review_duration_ms: [120_000, 300_000],
  paste_ratio: 0.55,
};

export function mergeHumanEngineSim(raw: Record<string, unknown> | null | undefined): HumanEngineSimConfig {
  if (!raw) return DEFAULT_HUMAN_ENGINE_SIM;
  return {
    wpm_mean: typeof raw.wpm_mean === 'number' ? raw.wpm_mean : DEFAULT_HUMAN_ENGINE_SIM.wpm_mean,
    wpm_sigma: typeof raw.wpm_sigma === 'number' ? raw.wpm_sigma : DEFAULT_HUMAN_ENGINE_SIM.wpm_sigma,
    typo_rate: typeof raw.typo_rate === 'number' ? raw.typo_rate : DEFAULT_HUMAN_ENGINE_SIM.typo_rate,
    backspace_delay_ms: Array.isArray(raw.backspace_delay_ms) && raw.backspace_delay_ms.length === 2
      ? [Number(raw.backspace_delay_ms[0]), Number(raw.backspace_delay_ms[1])]
      : DEFAULT_HUMAN_ENGINE_SIM.backspace_delay_ms,
    paragraph_pause_ms: Array.isArray(raw.paragraph_pause_ms) && raw.paragraph_pause_ms.length === 2
      ? [Number(raw.paragraph_pause_ms[0]), Number(raw.paragraph_pause_ms[1])]
      : DEFAULT_HUMAN_ENGINE_SIM.paragraph_pause_ms,
    review_duration_ms: Array.isArray(raw.review_duration_ms) && raw.review_duration_ms.length === 2
      ? [Number(raw.review_duration_ms[0]), Number(raw.review_duration_ms[1])]
      : DEFAULT_HUMAN_ENGINE_SIM.review_duration_ms,
    paste_ratio: typeof raw.paste_ratio === 'number' ? raw.paste_ratio : DEFAULT_HUMAN_ENGINE_SIM.paste_ratio,
  };
}

export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function gaussianRandom(mean: number, sigma: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.max(20, mean + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
}

export function wpmToDelay(wpm: number): number {
  return Math.round(60000 / (wpm * 5));
}

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
  'ㅑ': ['ㅏ', 'ㅣ'], 'ㅒ': ['ㅐ', 'ㅔ'], 'ㅖ': ['ㅔ', 'ㅒ'],
};

const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const MEDIALS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const STANDALONE_JAMO = new Set([...INITIALS, ...MEDIALS, ...FINALS.filter(Boolean)]);

export function isHangul(char: string): boolean {
  return /[\uac00-\ud7a3]/.test(char);
}

function decomposeHangul(char: string): string[] {
  const code = char.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return [];
  const uni = code - 0xac00;
  const i = Math.floor(uni / 588);
  const m = Math.floor((uni % 588) / 28);
  const f = uni % 28;
  const jamos = [INITIALS[i]!, MEDIALS[m]!];
  if (f > 0) jamos.push(FINALS[f]!);
  return jamos;
}

function recomposeHangul(jamos: string[]): string {
  if (jamos.length < 2) return jamos.join('');
  const i = INITIALS.indexOf(jamos[0]!);
  const m = MEDIALS.indexOf(jamos[1]!);
  const f = jamos.length > 2 ? FINALS.indexOf(jamos[2]!) : 0;
  if (i < 0 || m < 0 || f < 0) return jamos.join('');
  return String.fromCharCode(0xac00 + i * 588 + m * 28 + f);
}

function pickWrongAdjacent(original: string, neighbors: string[] | undefined): string {
  if (!neighbors?.length) return original;
  const pool = neighbors.filter((n) => n !== original);
  if (!pool.length) return neighbors[0]!;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function getAdjacentKeyLatin(char: string): string {
  const lower = char.toLowerCase();
  return pickWrongAdjacent(lower, ADJACENT[lower]) || char;
}

export function getAdjacentKey(char: string): string {
  if (isHangul(char)) {
    const jamos = decomposeHangul(char);
    if (!jamos.length) return getAdjacentKeyLatin(char);
    const wrongInitial = pickWrongAdjacent(jamos[0]!, DUBEOLSIK_ADJACENT[jamos[0]!]);
    return recomposeHangul([wrongInitial, ...jamos.slice(1)]);
  }
  return getAdjacentKeyLatin(char);
}

function getAdjacentJamo(jamo: string): string {
  return pickWrongAdjacent(jamo, DUBEOLSIK_ADJACENT[jamo]) || jamo;
}

function composeDisplay(jamos: string[]): string {
  if (jamos.length === 0) return '';
  if (jamos.length === 1) return jamos[0]!;
  const composed = recomposeHangul(jamos);
  return composed || jamos.join('');
}

export class LiveTextBuffer {
  private node: Text;
  private committed = '';
  private composingJamos: string[] = [];

  constructor(host: HTMLElement) {
    host.textContent = '';
    this.node = document.createTextNode('');
    host.appendChild(this.node);
  }

  private render() {
    this.node.data = this.committed + composeDisplay(this.composingJamos);
  }

  append(chunk: string) {
    this.composingJamos = [];
    this.committed += chunk;
    this.render();
  }

  backspace(count = 1) {
    this.composingJamos = [];
    this.committed = this.committed.slice(0, Math.max(0, this.committed.length - count));
    this.render();
  }

  /** 한글 IME 백스페이스 — 미완성 자모(ㅛ·ㅗ·ㅏ 등)부터 삭제 */
  backspaceIme(): void {
    if (this.composingJamos.length > 0) {
      this.composingJamos.pop();
      this.render();
      return;
    }
    if (this.committed.length === 0) return;

    const last = this.committed.at(-1)!;
    if (isHangul(last)) {
      const jamos = decomposeHangul(last);
      if (jamos.length > 2) {
        this.committed = this.committed.slice(0, -1);
        this.composingJamos = jamos.slice(0, -1);
        this.render();
        return;
      }
      if (jamos.length === 2) {
        this.committed = this.committed.slice(0, -1);
        this.composingJamos = [jamos[0]!];
        this.render();
        return;
      }
    } else if (STANDALONE_JAMO.has(last)) {
      this.committed = this.committed.slice(0, -1);
      this.render();
      return;
    }

    this.committed = this.committed.slice(0, -1);
    this.render();
  }

  setComposingJamos(jamos: string[]) {
    this.composingJamos = [...jamos];
    this.render();
  }

  commitComposedSyllable() {
    const syllable = composeDisplay(this.composingJamos);
    if (syllable && isHangul(syllable)) {
      this.committed += syllable;
    } else if (syllable) {
      this.committed += syllable;
    }
    this.composingJamos = [];
    this.render();
  }

  replaceCharAt(index: number, char: string) {
    const t = this.text;
    if (index < 0 || index >= t.length) return;
    this.composingJamos = [];
    this.committed = t.slice(0, index) + char + t.slice(index + 1);
    this.render();
  }

  deleteCharAt(index: number) {
    const t = this.text;
    if (index < 0 || index >= t.length) return;
    this.composingJamos = [];
    this.committed = t.slice(0, index) + t.slice(index + 1);
    this.render();
  }

  insertAt(index: number, text: string) {
    const t = this.text;
    const safe = Math.max(0, Math.min(index, t.length));
    this.composingJamos = [];
    this.committed = t.slice(0, safe) + text + t.slice(safe);
    this.render();
  }

  get text() {
    return this.node.data;
  }

  get length() {
    return this.node.data.length;
  }
}

export type ReviewTypoFix = {
  index: number;
  wrong: string;
  correct: string;
};

/** 발행 전 검토에서 고칠 '놓친' 오탈자 삽입 */
export function plantReviewTypos(buffer: LiveTextBuffer, min = 2, max = 4): ReviewTypoFix[] {
  const text = buffer.text;
  const fixes: ReviewTypoFix[] = [];
  const candidates: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (isHangul(c) || /[a-zA-Z0-9가-힣]/.test(c)) candidates.push(i);
  }

  if (candidates.length < min) return fixes;

  const count = randomBetween(min, Math.min(max, candidates.length));
  const picked = new Set<number>();

  while (picked.size < count) {
    const idx = candidates[Math.floor(Math.random() * candidates.length)]!;
    if (picked.has(idx)) continue;
    const correct = text[idx]!;
    let wrong = getAdjacentKey(correct);
    if (wrong === correct) wrong = getAdjacentJamo(correct) || correct;
    if (wrong === correct) continue;
    picked.add(idx);
    buffer.replaceCharAt(idx, wrong);
    fixes.push({ index: idx, wrong, correct });
  }

  return fixes.sort((a, b) => a.index - b.index);
}

export function pickPasteIndices(total: number, ratio = 0.55): Set<number> {
  const pasteCount = Math.floor(total * ratio);
  const indices = new Set<number>();
  while (indices.size < pasteCount && indices.size < total) {
    indices.add(Math.floor(Math.random() * total));
  }
  return indices;
}

export function formatPasteTypeRatio(ratio = 0.55): string {
  const pastePct = Math.round(ratio * 100);
  return `복붙${pastePct}%·OS IME/타이핑${100 - pastePct}%`;
}

/** typePostContent — paste_ratio(기본55%) 단락 복붙 · 나머지 IME 타이핑 */
export async function typePostContentSim(
  content: string,
  buffer: LiveTextBuffer,
  config: HumanEngineSimConfig,
  cancelled: () => boolean,
  onTick?: () => void,
  callbacks?: { onPaste?: () => void },
): Promise<void> {
  const paragraphs = content.split('\n\n').filter(Boolean);
  const total = paragraphs.length;
  if (total === 0) return;

  const pasteIndices = pickPasteIndices(total, config.paste_ratio ?? 0.55);

  for (let i = 0; i < total; i++) {
    if (cancelled()) return;
    const para = paragraphs[i]!;

    if (pasteIndices.has(i)) {
      const plan = planParagraphPaste(para);
      const segments = plan.hasPaste ? plan.segments : [{ kind: 'paste' as const, text: para }];
      for (const seg of segments) {
        if (cancelled()) return;
        if (seg.kind === 'paste') {
          callbacks?.onPaste?.();
          buffer.append(seg.text);
          onTick?.();
          await sleepMs(randomBetween(400, 900), cancelled);
        } else {
          await humanTypeSim(seg.text, buffer, config, cancelled, onTick);
        }
      }
    } else {
      await humanTypeSim(para, buffer, config, cancelled, onTick);
    }

    if (i < total - 1) {
      buffer.append('\n\n');
      onTick?.();
      await sleepMs(randomBetween(config.paragraph_pause_ms[0], config.paragraph_pause_ms[1]), cancelled);
    }
  }
}

/** 본문 말미 URL Ctrl+V → OG 카드 (연운) */
export async function pasteBlogLinkOgSim(
  buffer: LiveTextBuffer,
  linkUrl: string,
  config: HumanEngineSimConfig,
  cancelled: () => boolean,
  callbacks?: { onPaste?: () => void; onOgCard?: () => void; onTick?: () => void },
): Promise<void> {
  buffer.append('\n\n');
  callbacks?.onTick?.();
  await sleepMs(randomBetween(300, 700), cancelled);
  callbacks?.onPaste?.();
  await sleepMs(randomBetween(400, 800), cancelled);
  callbacks?.onOgCard?.();
}

/** @deprecated pasteBlogLinkOgSim 사용 */
export async function typeYeonunBlogLinkSim(
  buffer: LiveTextBuffer,
  config: HumanEngineSimConfig,
  cancelled: () => boolean,
  onTick?: () => void,
): Promise<void> {
  await pasteBlogLinkOgSim(buffer, 'https://yeonun.com', config, cancelled, { onTick });
}

/** @deprecated pasteBlogLinkOgSim 사용 */
export async function pasteBlogLinkSim(
  linkUrl: string,
  buffer: LiveTextBuffer,
  cancelled: () => boolean,
  callbacks?: { onOgCard?: () => void; onTick?: () => void },
): Promise<void> {
  await pasteBlogLinkOgSim(buffer, linkUrl, DEFAULT_HUMAN_ENGINE_SIM, cancelled, callbacks);
}

export async function sleepMs(ms: number, cancelled: () => boolean): Promise<void> {
  await new Promise<void>((resolve) => {
    const id = window.setTimeout(resolve, ms);
    if (cancelled()) window.clearTimeout(id);
  });
}

async function typeJamoWithTypo(
  jamo: string,
  built: string[],
  buffer: LiveTextBuffer,
  config: HumanEngineSimConfig,
  cancelled: () => boolean,
  onTick?: () => void,
): Promise<void> {
  if (Math.random() < config.typo_rate) {
    const wrong = getAdjacentJamo(jamo);
    if (wrong !== jamo) {
      built.push(wrong);
      buffer.setComposingJamos(built);
      onTick?.();
      await sleepMs(randomBetween(180, 420), cancelled);
      built.pop();
      buffer.setComposingJamos(built);
      onTick?.();
      await sleepMs(randomBetween(config.backspace_delay_ms[0], config.backspace_delay_ms[1]), cancelled);
    }
  }

  built.push(jamo);
  buffer.setComposingJamos(built);
  onTick?.();
  await sleepMs(wpmToDelay(gaussianRandom(config.wpm_mean, config.wpm_sigma)), cancelled);
}

async function typeHangulChar(
  char: string,
  buffer: LiveTextBuffer,
  config: HumanEngineSimConfig,
  cancelled: () => boolean,
  onTick?: () => void,
): Promise<void> {
  const jamos = decomposeHangul(char);
  if (jamos.length < 2) {
    await typePlainChar(char, buffer, config, cancelled, onTick);
    return;
  }

  const built: string[] = [];
  for (let i = 0; i < jamos.length; i++) {
    if (cancelled()) return;
    await typeJamoWithTypo(jamos[i]!, built, buffer, config, cancelled, onTick);
  }
  buffer.commitComposedSyllable();
  onTick?.();
}

async function typePlainChar(
  char: string,
  buffer: LiveTextBuffer,
  config: HumanEngineSimConfig,
  cancelled: () => boolean,
  onTick?: () => void,
): Promise<void> {
  if (Math.random() < config.typo_rate) {
    const wrong = getAdjacentKey(char);
    if (wrong !== char) {
      buffer.append(wrong);
      onTick?.();
      await sleepMs(randomBetween(180, 420), cancelled);
      buffer.backspaceIme();
      onTick?.();
      await sleepMs(randomBetween(config.backspace_delay_ms[0], config.backspace_delay_ms[1]), cancelled);
    }
  }

  buffer.append(char);
  onTick?.();
  await sleepMs(wpmToDelay(gaussianRandom(config.wpm_mean, config.wpm_sigma)), cancelled);
}

/** humanType — 오타(인접키·자모) → 백스페이스 → 정자 입력 */
export async function humanTypeSim(
  text: string,
  buffer: LiveTextBuffer,
  config: HumanEngineSimConfig,
  cancelled: () => boolean,
  onTick?: () => void,
): Promise<void> {
  for (const char of text) {
    if (cancelled()) return;
    if (isHangul(char)) {
      await typeHangulChar(char, buffer, config, cancelled, onTick);
    } else {
      await typePlainChar(char, buffer, config, cancelled, onTick);
    }
  }
}

export type ReviewCursorCallbacks = {
  onProgress?: (remainingSec: number) => void;
  onMouseMove?: (x: number, y: number) => void;
  onMouseClick?: () => void;
  onKeyNav?: (key: string) => void;
  /** 본문 글자 앞/뒤 캐럿 화면 좌표 — null이면 숨김 */
  onCaretAt?: (point: { x: number; y: number; height: number } | null) => void;
};

/** Range API로 본문 텍스트 노드의 캐럿 화면 좌표 측정 */
export function measureTextCaretPoint(
  bodyHost: HTMLElement,
  index: number,
  side: 'before' | 'after' = 'before',
): { x: number; y: number; height: number } | null {
  const textNode = [...bodyHost.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;

  const len = textNode.textContent?.length ?? 0;
  const offset = side === 'before' ? Math.min(index, len) : Math.min(index + 1, len);
  const range = document.createRange();
  range.setStart(textNode, offset);
  range.setEnd(textNode, offset);

  let rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if ((!rect.width && !rect.height) && offset > 0) {
    range.setStart(textNode, offset - 1);
    range.setEnd(textNode, offset);
    rect = range.getBoundingClientRect();
    return { x: rect.right, y: rect.top, height: rect.height || 18 };
  }

  return { x: rect.left, y: rect.top, height: rect.height || 18 };
}

function scrollToCaret(
  scrollContainer: HTMLElement,
  bodyHost: HTMLElement,
  index: number,
): void {
  const point = measureTextCaretPoint(bodyHost, index, 'before');
  if (!point) return;
  const scrollRect = scrollContainer.getBoundingClientRect();
  const relY = point.y - scrollRect.top + scrollContainer.scrollTop;
  scrollContainer.scrollTop = Math.max(
    0,
    Math.min(scrollContainer.scrollHeight, relY - scrollContainer.clientHeight / 3),
  );
}

function bezierPoint(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

async function moveMouseBezier(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
  onMove: (x: number, y: number) => void,
  cancelled: () => boolean,
): Promise<void> {
  const cp1 = { x: from.x + (to.x - from.x) * 0.3 + randomBetween(-30, 30), y: from.y + randomBetween(-20, 20) };
  const cp2 = { x: from.x + (to.x - from.x) * 0.7 + randomBetween(-30, 30), y: to.y + randomBetween(-20, 20) };

  for (let i = 1; i <= steps; i++) {
    if (cancelled()) return;
    const t = i / steps;
    onMove(
      bezierPoint(t, from.x, cp1.x, cp2.x, to.x),
      bezierPoint(t, from.y, cp1.y, cp2.y, to.y),
    );
    await sleepMs(randomBetween(12, 28), cancelled);
  }
}

function caretClickPoint(
  bodyHost: HTMLElement,
  index: number,
): { x: number; y: number; height: number; caretIndex: number } | null {
  const side: 'before' | 'after' = Math.random() < 0.5 ? 'before' : 'after';
  const caretIndex = side === 'before' ? index : index + 1;
  const point = measureTextCaretPoint(bodyHost, index, side);
  if (!point) return null;
  return {
    x: point.x + randomBetween(-1, 1),
    y: point.y + point.height / 2 + randomBetween(-1, 1),
    height: point.height,
    caretIndex,
  };
}

/** 발행 전 검토 — 오탈자 위치에 마우스 클릭 · 캐럿 깜박임 · 글자 수정 */
export async function simulateTypoReview(
  scrollContainer: HTMLElement,
  bodyHost: HTMLElement,
  buffer: LiveTextBuffer,
  fixes: ReviewTypoFix[],
  durationMs: number,
  cancelled: () => boolean,
  callbacks?: ReviewCursorCallbacks,
): Promise<void> {
  const start = Date.now();
  let mouse = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
  callbacks?.onMouseMove?.(mouse.x, mouse.y);

  const fixQueue = [...fixes];
  let lastFixAt = 0;

  const showCaret = (caretIndex: number) => {
    const pt = measureTextCaretPoint(bodyHost, caretIndex, 'before');
    callbacks?.onCaretAt?.(pt ? { x: pt.x, y: pt.y, height: pt.height } : null);
  };

  while (Date.now() - start < durationMs) {
    if (cancelled()) return;
    const remaining = Math.ceil((durationMs - (Date.now() - start)) / 1000);
    callbacks?.onProgress?.(remaining);

    const elapsedSinceFix = Date.now() - lastFixAt;
    const shouldFix =
      fixQueue.length > 0 &&
      (elapsedSinceFix > randomBetween(2500, 6000) || (fixQueue.length === fixes.length && elapsedSinceFix > 1200));

    if (shouldFix) {
      const fix = fixQueue[0]!;
      scrollToCaret(scrollContainer, bodyHost, fix.index);
      await sleepMs(randomBetween(350, 700), cancelled);

      const clickTarget = caretClickPoint(bodyHost, fix.index);
      if (!clickTarget) {
        await sleepMs(randomBetween(300, 500), cancelled);
        continue;
      }
      fixQueue.shift()!;

      let caretIndex = clickTarget.caretIndex;
      if (caretIndex > fix.index) {
        callbacks?.onKeyNav?.('ArrowLeft');
        await sleepMs(randomBetween(80, 150), cancelled);
        caretIndex = fix.index;
      }

      await moveMouseBezier(
        mouse,
        { x: clickTarget.x, y: clickTarget.y },
        randomBetween(20, 34),
        (x, y) => {
          mouse = { x, y };
          callbacks?.onMouseMove?.(x, y);
        },
        cancelled,
      );

      callbacks?.onMouseClick?.();
      showCaret(caretIndex);
      await sleepMs(randomBetween(280, 520), cancelled);

      const wrongChar = buffer.text[fix.index] ?? fix.wrong;

      if (isHangul(wrongChar)) {
        const jamos = decomposeHangul(wrongChar);
        for (let j = jamos.length - 1; j >= 0; j--) {
          callbacks?.onKeyNav?.('Backspace');
          if (j === 0) {
            buffer.deleteCharAt(fix.index);
          } else {
            buffer.replaceCharAt(fix.index, composeDisplay(jamos.slice(0, j)));
          }
          showCaret(fix.index);
          await sleepMs(randomBetween(140, 320), cancelled);
        }
      } else {
        callbacks?.onKeyNav?.('Backspace');
        buffer.deleteCharAt(fix.index);
        showCaret(fix.index);
        await sleepMs(randomBetween(200, 450), cancelled);
      }

      if (isHangul(fix.correct)) {
        const jamos = decomposeHangul(fix.correct);
        for (let j = 1; j <= jamos.length; j++) {
          const partial = composeDisplay(jamos.slice(0, j));
          if (buffer.text[fix.index] === undefined || j === 1) {
            buffer.insertAt(fix.index, partial);
          } else {
            buffer.replaceCharAt(fix.index, partial);
          }
          showCaret(fix.index + 1);
          await sleepMs(randomBetween(90, 200), cancelled);
        }
      } else {
        buffer.insertAt(fix.index, fix.correct);
        showCaret(fix.index + 1);
        await sleepMs(randomBetween(120, 240), cancelled);
      }

      lastFixAt = Date.now();
      await sleepMs(randomBetween(600, 1400), cancelled);
      callbacks?.onCaretAt?.(null);
    } else {
      callbacks?.onCaretAt?.(null);
      scrollContainer.scrollTop = Math.min(
        scrollContainer.scrollHeight,
        scrollContainer.scrollTop + randomBetween(40, 100),
      );
      await sleepMs(randomBetween(600, 1400), cancelled);
    }
  }

  callbacks?.onCaretAt?.(null);
  callbacks?.onProgress?.(0);
}

export type PostingPhase =
  | 'enter_editor'
  | 'title'
  | 'title_pause'
  | 'body_click'
  | 'body'
  | 'link'
  | 'image_upload'
  | 'video_upload'
  | 'review'
  | 'publish'
  | 'publish_dialog'
  | 'publish_tags'
  | 'publish_confirm'
  | 'done';

export const POSTING_PHASE_LABELS: Record<PostingPhase, string> = {
  enter_editor: '네이버 블로그 에디터 진입',
  title: '제목 (#subjectTextBox) humanClick + 타이핑',
  title_pause: '제목 입력 후 사고 정지',
  body_click: '본문 (.se-content) humanClick',
  body: '본문 typePostContent (복붙55%·OS IME/타이핑45%)',
  link: '링크 — 연운: 본문 Ctrl+V(OG) · 그 외: 툴바 「링크」',
  image_upload: '툴바 「사진」 humanClick → filechooser',
  video_upload: '툴바 「동영상」 humanClick → filechooser',
  review: '발행 전 검토 (오탈자 수정)',
  publish: '상단 발행 버튼 humanClick',
  publish_dialog: '2차 패널 카테고리 선택',
  publish_tags: '태그 # + humanType → Space/Enter 칩 완성',
  publish_confirm: '우하단 최종 발행 humanClick (검증: 자동 클릭·실제 미발행)',
  done: '완료 (검증 모드 — 실제 발행 없음)',
};

/** @deprecated scrollReview 대체 */
export async function simulateScrollReview(
  container: HTMLElement,
  durationMs: number,
  cancelled: () => boolean,
  onProgress?: (remainingSec: number) => void,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    if (cancelled()) return;
    onProgress?.(Math.ceil((durationMs - (Date.now() - start)) / 1000));
    container.scrollTop = Math.min(container.scrollHeight, container.scrollTop + randomBetween(60, 180));
    await sleepMs(randomBetween(800, 2500), cancelled);
  }
  onProgress?.(0);
}
