/** 브라우저용 — server human-engine/typing.ts · timing.ts 와 동일 로직 */

export type HumanEngineSimConfig = {
  wpm_mean: number;
  wpm_sigma: number;
  typo_rate: number;
  backspace_delay_ms: [number, number];
  paragraph_pause_ms: [number, number];
  review_duration_ms: [number, number];
};

export const DEFAULT_HUMAN_ENGINE_SIM: HumanEngineSimConfig = {
  wpm_mean: 38,
  wpm_sigma: 18,
  typo_rate: 0.09,
  backspace_delay_ms: [200, 800],
  paragraph_pause_ms: [2000, 8000],
  review_duration_ms: [120_000, 300_000],
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

export function pickPasteIndices(total: number): Set<number> {
  const pasteCount = Math.floor(total * 0.3);
  const indices = new Set<number>();
  while (indices.size < pasteCount && indices.size < total) {
    indices.add(Math.floor(Math.random() * total));
  }
  return indices;
}

function pickSnippet(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen).trim()}…`;
}

/** 서비스 화면(운세·사주 결과)에서 복붙한 것처럼 보이는 클립 */
export function buildServicePasteClip(sourceParagraph: string): string {
  const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  const snippet = pickSnippet(sourceParagraph, 72);

  const hasMoney = /돈|재물|수입|월급|금전|부자|재테크|돈벌|용돈|투자/.test(sourceParagraph);
  const hasLove = /사랑|연애|재회|이별|인연|남친|여친|썸|결혼|짝/.test(sourceParagraph);
  const hasCareer = /직장|승진|이직|사업|취업|면접|커리어/.test(sourceParagraph);

  if (hasMoney) {
    const stars = '★'.repeat(randomBetween(3, 5)) + '☆'.repeat(randomBetween(0, 2));
    return `[연운 재물운 결과 · ${date}]\n\n💰 재물운: ${stars}\n3개월 내 수입 변화: +${randomBetween(8, 22)}% 가능\n핵심 시기: ${randomBetween(1, 3)}개월 후\n\n"${snippet}"\n\n※ yeonun.com 결과 화면에서 복사`;
  }
  if (hasLove) {
    const stars = '★'.repeat(randomBetween(2, 4)) + '☆'.repeat(randomBetween(1, 3));
    return `[연운 연애·인연 결과 · ${date}]\n\n💕 인연운: ${stars}\n재회·새 인연: ${randomBetween(40, 85)}% 긍정\n\n"${snippet}"\n\n※ yeonun.com 결과 화면에서 복사`;
  }
  if (hasCareer) {
    return `[연운 직장·사업운 · ${date}]\n\n📋 종합: ${randomBetween(62, 91)}점\n승진·변화 시기: ${randomBetween(2, 6)}월\n\n"${snippet}"\n\n※ yeonun.com 결과 화면에서 복사`;
  }

  return `[연운 사주·운세 결과 · ${date}]\n\n✨ 종합 운세: ${randomBetween(58, 88)}점\n\n"${snippet}"\n\n※ yeonun.com 결과 화면에서 복사`;
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

/** typePostContent — 단락 30% 서비스화면 복붙 · 70% 타이핑 */
export async function typePostContentSim(
  content: string,
  buffer: LiveTextBuffer,
  config: HumanEngineSimConfig,
  cancelled: () => boolean,
  onTick?: () => void,
): Promise<void> {
  const paragraphs = content.split('\n\n').filter(Boolean);
  const total = paragraphs.length;
  if (total === 0) return;

  const pasteIndices = pickPasteIndices(total);

  for (let i = 0; i < total; i++) {
    if (cancelled()) return;
    const para = paragraphs[i]!;

    if (pasteIndices.has(i)) {
      const clip = buildServicePasteClip(para);
      buffer.append(clip);
      onTick?.();
      await sleepMs(randomBetween(400, 900), cancelled);
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

export type ReviewCursorCallbacks = {
  onProgress?: (remainingSec: number) => void;
  onMouseMove?: (x: number, y: number) => void;
  onMouseClick?: () => void;
  onKeyNav?: (key: string) => void;
};

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

function estimateCharPosition(bodyHost: HTMLElement, index: number): { x: number; y: number } {
  const rect = bodyHost.getBoundingClientRect();
  const text = bodyHost.textContent ?? '';
  const lineLen = Math.max(28, Math.floor(rect.width / 15));
  const line = Math.floor(index / lineLen);
  const col = index % lineLen;
  return {
    x: rect.left + 24 + col * 14 + randomBetween(-4, 4),
    y: rect.top + 32 + line * 30 + randomBetween(-3, 3),
  };
}

/** 발행 전 검토 — 오탈자 찾아 마우스·키보드로 수정 */
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

  while (Date.now() - start < durationMs) {
    if (cancelled()) return;
    const remaining = Math.ceil((durationMs - (Date.now() - start)) / 1000);
    callbacks?.onProgress?.(remaining);

    if (fixQueue.length > 0 && Math.random() < 0.55) {
      const fix = fixQueue.shift()!;
      scrollContainer.scrollTop = Math.max(
        0,
        Math.min(
          scrollContainer.scrollHeight,
          Math.floor(fix.index / 28) * 30 - scrollContainer.clientHeight / 3,
        ),
      );
      await sleepMs(randomBetween(400, 900), cancelled);

      const target = estimateCharPosition(bodyHost, fix.index);
      await moveMouseBezier(mouse, target, randomBetween(18, 32), (x, y) => {
        mouse = { x, y };
        callbacks?.onMouseMove?.(x, y);
      }, cancelled);

      callbacks?.onMouseClick?.();
      await sleepMs(randomBetween(120, 280), cancelled);

      if (Math.random() < 0.4) {
        callbacks?.onKeyNav?.('PageDown');
        await sleepMs(randomBetween(200, 500), cancelled);
        for (let k = 0; k < randomBetween(2, 6); k++) {
          callbacks?.onKeyNav?.('ArrowLeft');
          await sleepMs(randomBetween(80, 160), cancelled);
        }
      }

      const wrongChar = buffer.text[fix.index] ?? fix.wrong;

      if (isHangul(wrongChar)) {
        const jamos = decomposeHangul(wrongChar);
        for (let j = jamos.length - 1; j >= 0; j--) {
          if (j === 0) {
            buffer.deleteCharAt(fix.index);
          } else {
            buffer.replaceCharAt(fix.index, composeDisplay(jamos.slice(0, j)));
          }
          await sleepMs(randomBetween(140, 320), cancelled);
        }
      } else {
        buffer.deleteCharAt(fix.index);
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
          await sleepMs(randomBetween(90, 200), cancelled);
        }
      } else {
        buffer.insertAt(fix.index, fix.correct);
      }

      await sleepMs(randomBetween(800, 2000), cancelled);
    } else {
      scrollContainer.scrollTop = Math.min(
        scrollContainer.scrollHeight,
        scrollContainer.scrollTop + randomBetween(40, 100),
      );
      await sleepMs(randomBetween(600, 1400), cancelled);
    }
  }

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
  | 'review'
  | 'publish'
  | 'done';

export const POSTING_PHASE_LABELS: Record<PostingPhase, string> = {
  enter_editor: '네이버 블로그 에디터 진입',
  title: '제목 (#subjectTextBox) 타이핑',
  title_pause: '제목 입력 후 사고 정지',
  body_click: '본문 (.se-content) 클릭',
  body: '본문 typePostContent (복붙30%·타이핑70%)',
  link: '링크 URL 추가',
  image_upload: '사진 파일 업로드 (insertImage)',
  review: '발행 전 검토 (오탈자 수정)',
  publish: '발행 버튼 클릭',
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
