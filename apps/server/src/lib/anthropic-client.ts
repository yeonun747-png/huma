interface ClaudeMessageResponse {
  content?: Array<{ type: string; text?: string }>;
}

type ClaudeContent = string | Array<Record<string, unknown>>;

const DEFAULT_LLM_TIMEOUT_MS = 120_000;

function llmTimeoutMs(override?: number): number {
  if (override != null && override > 0) return override;
  const env = Number(process.env.CONTI_LLM_TIMEOUT_MS);
  return env > 0 ? env : DEFAULT_LLM_TIMEOUT_MS;
}

export async function askClaudeWithModel(params: {
  model?: string;
  max_tokens?: number;
  prompt?: string;
  system?: string;
  content?: ClaudeContent;
  timeout_ms?: number;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const userContent = params.content ?? params.prompt ?? '';
  if (!userContent) return null;

  const timeoutMs = llmTimeoutMs(params.timeout_ms);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: params.model ?? 'claude-sonnet-4-6',
        max_tokens: params.max_tokens ?? 1024,
        ...(params.system ? { system: params.system } : {}),
        messages: [{ role: 'user', content: userContent }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as ClaudeMessageResponse;
    const block = data.content?.[0];
    return block?.type === 'text' ? block.text ?? null : null;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Claude API 시간 초과 (${Math.round(timeoutMs / 1000)}초)`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function askClaude(prompt: string, maxTokens = 100): Promise<string | null> {
  return askClaudeWithModel({ prompt, max_tokens: maxTokens });
}

/** Claude Sonnet Vision — CAPTCHA 이미지 해석 (단일·다중 이미지) */
export async function askClaudeVision(params: {
  model?: string;
  system?: string;
  question: string;
  imageBase64?: string;
  images?: Array<{ base64: string; mediaType?: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' }>;
  mediaType?: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  max_tokens?: number;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const defaultMedia = params.mediaType ?? 'image/png';
  const imageBlocks: Array<{
    type: 'image';
    source: { type: 'base64'; media_type: string; data: string };
  }> = [];

  if (params.images?.length) {
    for (const img of params.images) {
      imageBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType ?? defaultMedia,
          data: img.base64,
        },
      });
    }
  } else if (params.imageBase64) {
    imageBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: defaultMedia,
        data: params.imageBase64,
      },
    });
  }

  if (!imageBlocks.length) return null;

  return askClaudeWithModel({
    model: params.model ?? 'claude-sonnet-4-6',
    max_tokens: params.max_tokens ?? 256,
    system: params.system,
    content: [
      ...imageBlocks,
      {
        type: 'text',
        text: params.question,
      },
    ],
  });
}
