interface ClaudeMessageResponse {
  content?: Array<{ type: string; text?: string }>;
}

export async function askClaude(prompt: string, maxTokens = 100): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
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
