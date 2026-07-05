export type QuizImageChoiceId = 'A' | 'B' | 'C' | 'D';

export interface QuizImagePromptItem {
  questionNumber: number;
  choiceId: QuizImageChoiceId | null;
  prompt: string;
  filename: string;
  isFaceQuestion: boolean;
  choiceCount: number;
}

export interface QuizImageParseQuestion {
  questionNumber: number;
  questionText: string;
  choiceCount: number;
  isFaceQuestion: boolean;
  choices: { id: QuizImageChoiceId; label: string }[];
  images: QuizImagePromptItem[];
}

export interface QuizImageParseResult {
  questions: QuizImageParseQuestion[];
  items: QuizImagePromptItem[];
  totalImages: number;
  choiceType: '2지선다' | '4지선다' | '혼합';
  errors: string[];
}

const SEPARATOR_RE = /^_{5,}$/;
const QUESTION_RE = /^Q(\d+)\.\s*(.+)$/;
const OPTION_RE = /^[•*·]\s*([A-Da-d])\.\s*(?:🖼️\s*)?(.+)$/;
const PROMPT_HEADER_RE = /^\[Q(\d+)\s*(.+?)\]$/;
const PROMPT_CHOICE_RE = /^[•*·]?\s*([A-Da-d])\s*이미지\s*:\s*(.+)$/;
const PROMPT_FACE_RE = /^[•*·]?\s*이미지\s*:\s*(.+)$/;

export function normalizeQuizImagePrefix(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '');
  if (!trimmed) return '';
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
  return safe.endsWith('_') ? safe : `${safe}_`;
}

export function buildQuizImageFilename(
  prefix: string,
  questionNumber: number,
  choiceId: QuizImageChoiceId | null,
): string {
  const p = normalizeQuizImagePrefix(prefix);
  const q = `q${questionNumber}`;
  if (choiceId) return `${p}${q}_${choiceId.toLowerCase()}.png`;
  return `${p}${q}.png`;
}

function detectChoiceType(counts: number[]): '2지선다' | '4지선다' | '혼합' {
  const uniq = [...new Set(counts.filter((c) => c > 0))];
  if (uniq.length === 0) return '4지선다';
  if (uniq.length === 1) return uniq[0] === 2 ? '2지선다' : '4지선다';
  return '혼합';
}

function toChoiceId(raw: string): QuizImageChoiceId {
  return raw.toUpperCase() as QuizImageChoiceId;
}

export function parseQuizImagePrompts(raw: string, prefix = ''): QuizImageParseResult {
  const errors: string[] = [];
  const normalizedPrefix = normalizeQuizImagePrefix(prefix);
  const lines = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !SEPARATOR_RE.test(l));

  const questions = new Map<number, QuizImageParseQuestion>();
  let mode: 'question' | 'prompt' = 'question';
  let currentPromptQuestion = 0;
  let promptHeaderFace = false;

  const ensureQuestion = (num: number): QuizImageParseQuestion => {
    let q = questions.get(num);
    if (!q) {
      q = {
        questionNumber: num,
        questionText: '',
        choiceCount: 0,
        isFaceQuestion: false,
        choices: [],
        images: [],
      };
      questions.set(num, q);
    }
    return q;
  };

  for (const line of lines) {
    const qMatch = line.match(QUESTION_RE);
    if (qMatch) {
      mode = 'question';
      promptHeaderFace = false;
      const num = Number(qMatch[1]);
      const q = ensureQuestion(num);
      q.questionText = qMatch[2]!.trim();
      continue;
    }

    const headerMatch = line.match(PROMPT_HEADER_RE);
    if (headerMatch) {
      mode = 'prompt';
      currentPromptQuestion = Number(headerMatch[1]);
      const headerText = headerMatch[2] ?? '';
      promptHeaderFace = /총면/.test(headerText);
      const q = ensureQuestion(currentPromptQuestion);
      if (promptHeaderFace) q.isFaceQuestion = true;
      continue;
    }

    if (mode === 'question') {
      const optMatch = line.match(OPTION_RE);
      if (optMatch) {
        const nums = [...questions.keys()].sort((a, b) => a - b);
        const num = nums.at(-1);
        if (num == null) {
          errors.push(`선택지 "${line.slice(0, 40)}…" — 앞에 Qn. 문항이 없습니다`);
          continue;
        }
        const q = ensureQuestion(num);
        const id = toChoiceId(optMatch[1]!);
        q.choices.push({ id, label: optMatch[2]!.trim() });
        q.choiceCount = q.choices.length;
        continue;
      }
    }

    if (mode === 'prompt') {
      if (!currentPromptQuestion) {
        errors.push(`프롬프트 "${line.slice(0, 40)}…" — 앞에 [Qn …] 헤더가 없습니다`);
        continue;
      }
      const num = currentPromptQuestion;
      const q = ensureQuestion(num);

      const choicePrompt = line.match(PROMPT_CHOICE_RE);
      if (choicePrompt) {
        const id = toChoiceId(choicePrompt[1]!);
        const prompt = choicePrompt[2]!.trim();
        q.images.push({
          questionNumber: num,
          choiceId: id,
          prompt,
          filename: buildQuizImageFilename(normalizedPrefix, num, id),
          isFaceQuestion: false,
          choiceCount: q.choiceCount || q.images.length + 1,
        });
        continue;
      }

      const facePrompt = line.match(PROMPT_FACE_RE);
      if (facePrompt || promptHeaderFace) {
        const prompt = facePrompt ? facePrompt[1]!.trim() : line.replace(/^[•*·]\s*/, '').trim();
        q.isFaceQuestion = true;
        q.images.push({
          questionNumber: num,
          choiceId: null,
          prompt,
          filename: buildQuizImageFilename(normalizedPrefix, num, null),
          isFaceQuestion: true,
          choiceCount: 0,
        });
        continue;
      }

      errors.push(`인식하지 못한 프롬프트 줄: ${line.slice(0, 60)}…`);
    }
  }

  const sorted = [...questions.values()].sort((a, b) => a.questionNumber - b.questionNumber);
  for (const q of sorted) {
    if (q.images.length === 0) {
      errors.push(`Q${q.questionNumber}: 이미지 프롬프트가 없습니다`);
    }
    if (!q.isFaceQuestion && q.choiceCount === 0 && q.images.length > 0) {
      q.choiceCount = q.images.length;
    }
    for (const img of q.images) {
      img.choiceCount = q.choiceCount;
      img.isFaceQuestion = q.isFaceQuestion;
    }
  }

  const items = sorted.flatMap((q) => q.images);
  const choiceCounts = sorted.filter((q) => !q.isFaceQuestion).map((q) => q.choiceCount);

  return {
    questions: sorted,
    items,
    totalImages: items.length,
    choiceType: detectChoiceType(choiceCounts),
    errors,
  };
}
