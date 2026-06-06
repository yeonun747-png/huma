/** huma_accounts.persona JSONB — 블로그 문체 병합용 */
export function normalizePersonaJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      /* legacy string — ignore */
    }
  }
  return {};
}

export function mergeBlogWritingPersonaField(
  existingPersona: unknown,
  blogWritingPersona: string,
): Record<string, unknown> {
  return {
    ...normalizePersonaJson(existingPersona),
    blogWritingPersona: blogWritingPersona.trim(),
  };
}
