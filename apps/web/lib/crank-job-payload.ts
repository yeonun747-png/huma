/** social_crank job content JSON (huma_jobs.content) */
export type SocialCrankJobPayload = {
  scheduledCrank?: boolean;
  ourBlogUrls?: string[];
  sessionMinutes?: number;
};

export function parseSocialCrankJobContent(content: string | null | undefined): SocialCrankJobPayload {
  if (!content?.trim()) return {};
  try {
    const parsed = JSON.parse(content) as SocialCrankJobPayload;
    return {
      scheduledCrank: parsed.scheduledCrank,
      ourBlogUrls: Array.isArray(parsed.ourBlogUrls)
        ? parsed.ourBlogUrls.filter((u) => typeof u === 'string' && u.length > 0)
        : [],
      sessionMinutes: typeof parsed.sessionMinutes === 'number' ? parsed.sessionMinutes : undefined,
    };
  } catch {
    return {};
  }
}

/** "C-Rank 스케줄 2026-06-05 · Account Name" → 계정 표시명 */
export function crankJobAccountLabel(title: string | null | undefined): string | null {
  if (!title?.trim()) return null;
  const parts = title.split('·').map((s) => s.trim());
  if (parts.length >= 2) return parts[parts.length - 1];
  return null;
}

export function blogUrlDisplay(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

const STATUS_KO: Record<string, string> = {
  pending: '대기',
  scheduled: '예약',
  running: 'LIVE 진행 중',
  paused: '일시정지',
  completed: '완료',
  failed: '실패',
};

export function jobStatusLabelKo(status: string): string {
  return STATUS_KO[status] ?? status;
}
