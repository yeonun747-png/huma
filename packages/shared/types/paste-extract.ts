export type PasteSegment = { kind: 'paste' | 'type'; text: string };

export type ParagraphPastePlan = {
  segments: PasteSegment[];
  hasPaste: boolean;
};

type QuoteSpan = { start: number; end: number; inner: string };

const QUOTE_PATTERNS = [
  /"([^"\n]{8,})"/g,
  /"([^"\n]{8,})"/g,
  /「([^」\n]{8,})」/g,
];

const COLLOQUIAL_END =
  /(?:요|죠|네요|거든요|잖아요|어요|에요|더라고요|더라구요|같아요|봤어요|했어요|랬어요|였어요)[.!?…~]*$/;

function isColloquialSentence(sentence: string): boolean {
  const t = sentence.trim();
  if (t.length < 10) return true;
  if (/(?:ㅎㅎ|ㅋㅋ|ㅠㅠ|ㅜㅜ)/.test(t)) return true;
  return COLLOQUIAL_END.test(t);
}

function findQuoteSpans(text: string): QuoteSpan[] {
  const spans: QuoteSpan[] = [];
  for (const pattern of QUOTE_PATTERNS) {
    const re = new RegExp(pattern.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      spans.push({
        start: m.index,
        end: m.index + m[0].length,
        inner: m[1]!.trim(),
      });
    }
  }
  return spans;
}

function extractFormalSentences(text: string): string[] {
  const withoutQuotes = text.replace(/"[^"\n]+"|"[^"\n]+"|「[^」\n]+」/g, ' ');
  const sentences = withoutQuotes
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  return sentences.filter((s) => !isColloquialSentence(s));
}

function segmentsFromSpan(paragraph: string, span: QuoteSpan): PasteSegment[] {
  const out: PasteSegment[] = [];
  const before = paragraph.slice(0, span.start);
  const after = paragraph.slice(span.end);
  if (before) out.push({ kind: 'type', text: before });
  out.push({ kind: 'paste', text: span.inner });
  if (after) out.push({ kind: 'type', text: after });
  return out;
}

function segmentsFromClip(paragraph: string, clip: string): PasteSegment[] | null {
  const idx = paragraph.indexOf(clip);
  if (idx < 0) return null;
  const out: PasteSegment[] = [];
  const before = paragraph.slice(0, idx);
  const after = paragraph.slice(idx + clip.length);
  if (before) out.push({ kind: 'type', text: before });
  out.push({ kind: 'paste', text: clip });
  if (after) out.push({ kind: 'type', text: after });
  return out;
}

/** 단락에서 ""·「」 인용 블록 또는 구어체가 아닌 문장을 복붙 구간으로 분리 */
export function planParagraphPaste(paragraph: string): ParagraphPastePlan {
  const trimmed = paragraph.trim();
  if (!trimmed) {
    return { segments: [], hasPaste: false };
  }

  const quoteSpans = findQuoteSpans(trimmed);
  if (quoteSpans.length) {
    const span = [...quoteSpans].sort((a, b) => b.inner.length - a.inner.length)[0]!;
    return { segments: segmentsFromSpan(trimmed, span), hasPaste: true };
  }

  const formal = extractFormalSentences(trimmed).sort((a, b) => b.length - a.length);
  for (const clip of formal) {
    const segments = segmentsFromClip(trimmed, clip);
    if (segments && segments.some((s) => s.kind === 'paste')) {
      const typedLen = segments.filter((s) => s.kind === 'type').reduce((n, s) => n + s.text.length, 0);
      if (typedLen >= 8 || segments.length > 1) {
        return { segments, hasPaste: true };
      }
    }
  }

  return { segments: [{ kind: 'type', text: trimmed }], hasPaste: false };
}
