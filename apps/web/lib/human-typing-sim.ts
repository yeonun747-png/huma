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
  const i = INITIALS.indexOf(jamos[0]!);
  const m = MEDIALS.indexOf(jamos[1]!);
  const f = jamos.length > 2 ? FINALS.indexOf(jamos[2]!) : 0;
  if (i < 0 || m < 0 || f < 0) return jamos.join('');
  return String.fromCharCode(0xac00 + i * 588 + m * 28 + f);
}

function getAdjacentKeyLatin(char: string): string {
  const lower = char.toLowerCase();
  const keys = ADJACENT[lower];
  if (!keys?.length) return char;
  return keys[Math.floor(Math.random() * keys.length)]!;
}

export function getAdjacentKey(char: string): string {
  if (/[\uac00-\ud7a3]/.test(char)) {
    const jamos = decomposeHangul(char);
    if (!jamos.length) return getAdjacentKeyLatin(char);
    const neighbors = DUBEOLSIK_ADJACENT[jamos[0]!];
    if (!neighbors?.length) return char;
    return recomposeHangul([neighbors[Math.floor(Math.random() * neighbors.length)]!, ...jamos.slice(1)]);
  }
  return getAdjacentKeyLatin(char);
}

export class LiveTextBuffer {
  private node: Text;

  constructor(host: HTMLElement) {
    host.textContent = '';
    this.node = document.createTextNode('');
    host.appendChild(this.node);
  }

  append(chunk: string) {
    this.node.data += chunk;
  }

  backspace(count = 1) {
    this.node.data = this.node.data.slice(0, Math.max(0, this.node.data.length - count));
  }

  get text() {
    return this.node.data;
  }

  get length() {
    return this.node.data.length;
  }
}

export function pickPasteIndices(total: number): Set<number> {
  const pasteCount = Math.floor(total * 0.3);
  const indices = new Set<number>();
  while (indices.size < pasteCount && indices.size < total) {
    indices.add(Math.floor(Math.random() * total));
  }
  return indices;
}

export async function sleepMs(ms: number, cancelled: () => boolean): Promise<void> {
  await new Promise<void>((resolve) => {
    const id = window.setTimeout(resolve, ms);
    if (cancelled()) window.clearTimeout(id);
  });
}

/** humanType — 오타 · 백스페이스 · 가우시안 WPM */
export async function humanTypeSim(
  text: string,
  buffer: LiveTextBuffer,
  config: HumanEngineSimConfig,
  cancelled: () => boolean,
  onTick?: () => void,
): Promise<void> {
  for (const char of text) {
    if (cancelled()) return;

    if (Math.random() < config.typo_rate) {
      buffer.append(getAdjacentKey(char));
      onTick?.();
      await sleepMs(randomBetween(200, 500), cancelled);
      buffer.backspace(1);
      onTick?.();
      await sleepMs(randomBetween(config.backspace_delay_ms[0], config.backspace_delay_ms[1]), cancelled);
    }

    buffer.append(char);
    onTick?.();
    await sleepMs(wpmToDelay(gaussianRandom(config.wpm_mean, config.wpm_sigma)), cancelled);
  }
}

/** typePostContent — 단락 30% 복붙 · Enter×2 · 문단 pause */
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
      buffer.append(para);
      onTick?.();
      await sleepMs(randomBetween(300, 800), cancelled);
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

/** scrollReview — 발행 전 검토 스크롤 */
export async function simulateScrollReview(
  container: HTMLElement,
  durationMs: number,
  cancelled: () => boolean,
  onProgress?: (remainingSec: number) => void,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    if (cancelled()) return;
    const remaining = Math.ceil((durationMs - (Date.now() - start)) / 1000);
    onProgress?.(remaining);

    if (Math.random() < 0.3) {
      container.scrollTop = Math.max(0, container.scrollTop - randomBetween(40, 120));
      await sleepMs(randomBetween(500, 1500), cancelled);
    } else {
      container.scrollTop = Math.min(
        container.scrollHeight,
        container.scrollTop + randomBetween(60, 180),
      );
    }
    await sleepMs(randomBetween(800, 2500), cancelled);
  }
  onProgress?.(0);
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
  review: '발행 전 검토 (scrollReview)',
  publish: '발행 버튼 클릭',
  done: '완료 (검증 모드 — 실제 발행 없음)',
};
