interface ClaudeMessageResponse {
  content?: Array<{ type: string; text?: string }>;
}

type ClaudeContent = string | Array<Record<string, unknown>>;

export async function askClaudeWithModel(params: {
  model?: string;
  max_tokens?: number;
  prompt?: string;
  system?: string;
  content?: ClaudeContent;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const userContent = params.content ?? params.prompt ?? '';
  if (!userContent) return null;

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
    });
    if (!res.ok) return null;

    const data = (await res.json()) as ClaudeMessageResponse;
    const block = data.content?.[0];
    return block?.type === 'text' ? block.text ?? null : null;
  } catch {
    return null;
  }
}

export async function askClaude(prompt: string, maxTokens = 100): Promise<string | null> {
  return askClaudeWithModel({ prompt, max_tokens: maxTokens });
}
