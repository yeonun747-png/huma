/** LLM 응답 — markdown fence 제거 + JSON.parse (+ 따옴표 복구) */

export function extractLlmJsonBody(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  let body = fence ? fence[1]!.trim() : trimmed;
  if (!fence && body.startsWith('```')) {
    body = body.replace(/^```(?:json)?\s*/i, '').trim();
  }
  body = body.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const objStart = body.indexOf('{');
  const arrStart = body.indexOf('[');
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
    const end = body.lastIndexOf('}');
    if (end > objStart) body = body.slice(objStart, end + 1);
  } else if (arrStart >= 0) {
    const end = body.lastIndexOf(']');
    if (end > arrStart) body = body.slice(arrStart, end + 1);
  }
  return body.trim();
}

/** 문자열 값 안의 이스케이프되지 않은 " 를 \\" 로 보정 */
export function repairLooseJsonStringQuotes(input: string): string {
  let out = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }

    if (escape) {
      out += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < input.length && /\s/u.test(input[j]!)) j++;
      const next = input[j];
      if (next === undefined || next === ',' || next === '}' || next === ']' || next === ':') {
        out += ch;
        inString = false;
      } else {
        out += '\\"';
      }
      continue;
    }

    out += ch;
  }

  return out;
}

export function parseLlmJsonBlock(raw: string): unknown {
  const body = extractLlmJsonBody(raw);
  try {
    return JSON.parse(body);
  } catch (firstErr) {
    const repaired = repairLooseJsonStringQuotes(body);
    if (repaired !== body) {
      try {
        return JSON.parse(repaired);
      } catch {
        /* fall through */
      }
    }
    throw firstErr instanceof Error ? firstErr : new Error(String(firstErr));
  }
}

export function isJsonParseError(err: unknown): boolean {
  if (err instanceof SyntaxError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('JSON') ||
    msg.includes('Unexpected token') ||
    msg.includes("Expected ','") ||
    msg.includes('Expected "') ||
    msg.includes('Unterminated string')
  );
}

const JSON_RETRY_SUFFIX =
  '\n\n⚠️ 이전 응답 JSON 파싱 실패. 유효한 JSON만 출력하라. ' +
  '문자열 값 안의 큰따옴표(")는 \\" 로 이스케이프하거나 작은따옴표/한글 따옴표(「」)로 바꿔라. ' +
  '설명·markdown fence 없이 JSON만.';

export async function callClaudeJsonWithRetry<T extends Record<string, unknown>>(params: {
  model: string;
  max_tokens: number;
  prompt: string;
  ask: (p: { model: string; max_tokens: number; prompt: string }) => Promise<string | null>;
  maxAttempts?: number;
}): Promise<{ parsed: T; raw: string }> {
  const maxAttempts = params.maxAttempts ?? 3;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const prompt =
      attempt === 0
        ? params.prompt
        : `${params.prompt}${JSON_RETRY_SUFFIX}${
            lastErr ? `\n파싱 오류: ${lastErr.message.slice(0, 200)}` : ''
          }`;
    try {
      const raw = await params.ask({ model: params.model, max_tokens: params.max_tokens, prompt });
      if (!raw?.trim()) throw new Error('LLM 응답 없음');
      return { parsed: parseLlmJsonBlock(raw) as T, raw };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const emptyResponse = lastErr.message === 'LLM 응답 없음';
      if (attempt < maxAttempts - 1 && (isJsonParseError(err) || emptyResponse)) continue;
      throw lastErr;
    }
  }

  throw lastErr ?? new Error('JSON 파싱 실패');
}
