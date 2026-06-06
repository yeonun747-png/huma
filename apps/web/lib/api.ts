import type { HumaJob, HumaAccount, HumaModem, HumaVideoQueue } from '@huma/shared';
import { cachedFetch, invalidateApiCache } from '@/lib/api-cache';

const API_BASE = process.env.NEXT_PUBLIC_HUMA_API_URL ?? 'http://localhost:3100';

function resolveRequestUrl(path: string, sameOrigin?: boolean): string {
  if (sameOrigin && typeof window !== 'undefined') {
    return new URL(path, window.location.origin).href;
  }
  if (sameOrigin) return path;
  return `${API_BASE}${path}`;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('huma_token');
}

type RequestOptions = RequestInit & { sameOrigin?: boolean; timeoutMs?: number };

function requestTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), timeoutMs);
  return ctrl.signal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { sameOrigin, timeoutMs, ...fetchOptions } = options;
  const token = getToken();
  const hasBody = fetchOptions.body !== undefined && fetchOptions.body !== null && fetchOptions.body !== '';
  const headers: Record<string, string> = {
    ...(fetchOptions.headers as Record<string, string>),
  };
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (token) headers['X-HUMA-KEY'] = token;

  const url = resolveRequestUrl(path, sameOrigin);
  const signal =
    fetchOptions.signal ??
    (timeoutMs != null ? requestTimeoutSignal(timeoutMs) : undefined);

  const res = await fetch(url, { ...fetchOptions, headers, signal }).catch((err: unknown) => {
    const hint = !sameOrigin && (path.includes('adsense') || path.includes('monetization'))
      ? ' 브라우저 광고 차단 확장 프로그램이 API 요청을 막았을 수 있습니다.'
      : '';
    const target = sameOrigin
      ? typeof window !== 'undefined'
        ? `${window.location.origin} → HUMA_API_URL`
        : '동일 출처 프록시'
      : API_BASE;
    const isTimeout =
      err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'TimeoutError');
    if (isTimeout) {
      throw new Error(
        `요청 시간 초과(20초). ${target}${hint}`,
      );
    }
    throw new Error(
      `API 서버에 연결할 수 없습니다 (${target}). apps/web에서 npm run dev 실행·HUMA_API_URL 확인.${hint}`,
    );
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText, message: res.statusText }))) as {
      error?: string;
      message?: string;
    };
    if (res.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('huma_token');
      window.dispatchEvent(new Event('huma:auth-expired'));
    }
    const detail = [err.error, err.message]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0 && s !== 'Not Found')
      .join(' — ');
    const fallback = res.statusText || 'API 요청 실패';
    throw new Error(detail || (err.error === 'Not Found' ? `API 경로 없음 (${res.status}) — 서버 git pull·build·pm2 restart 필요` : fallback));
  }
  return res.json();
}

function qs(params: Record<string, string | undefined>) {
  const q = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');
  return q ? `?${q}` : '';
}

function refreshNavCaches() {
  invalidateApiCache('nav-badges');
  invalidateApiCache('status');
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),
  status: (params?: { workspace?: string }, opts?: { force?: boolean }) =>
    cachedFetch(
      `status:${params?.workspace ?? 'all'}`,
      8_000,
      () =>
        request<{
          healthy: boolean;
          queueActive: boolean;
          running?: boolean;
          pendingJobs: number;
          queued?: number;
          liveAccounts?: number;
          nextScheduled?: string | null;
          activeAccounts: number;
          errors: number;
          paused: boolean;
        }>(`/api/status${qs(params ?? {})}`),
      opts,
    ),
  login: (username: string, password: string) =>
    request<{
      token: string;
      admin: { name: string; email: string; workspaces: string[]; isSuper?: boolean };
    }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request<{ adminId: string; email: string; workspaces: string[]; isSuper: boolean }>('/api/auth/me'),
  jobs: (params?: {
    status?: string;
    workspace?: string;
    platform?: string;
    job_type?: string;
    limit?: string;
  }) => request<HumaJob[]>(`/api/jobs${qs(params ?? {})}`),
  createJob: async (body: Partial<HumaJob>) => {
    const job = await request<HumaJob>('/api/jobs', { method: 'POST', body: JSON.stringify(body) });
    refreshNavCaches();
    return job;
  },
  createAutoContentJob: (body: {
    workspace: string;
    title: string;
    source_url: string;
    synopsis?: string;
    screenshot_base64?: string;
    content_type?: 'A' | 'B';
    content_type_auto?: boolean;
    auto_schedule?: boolean;
    schedule_time?: string;
    repeat_rule?: string;
    dry_run?: boolean;
  }) =>
    request<HumaJob>('/api/jobs/auto-content', { method: 'POST', body: JSON.stringify(body) }),
  getJob: (id: string) => request<HumaJob>(`/api/jobs/${id}`),
  /** Storage 비공개 버킷 — Service Key 프록시로 blob URL 생성 */
  fetchJobPreviewImageObjectUrl: async (jobId: string): Promise<string> => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/jobs/${jobId}/preview-image`, {
      headers: token ? { 'X-HUMA-KEY': token } : {},
    });
    if (!res.ok) throw new Error('미리보기 이미지 로드 실패');
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  contentPreview: (body: {
    workspace: string;
    title: string;
    source_url: string;
    synopsis?: string;
    screenshot_base64?: string;
    content_type?: 'A' | 'B';
    account_id?: string;
  }) =>
    request<{
      steps: Array<{ id: string; label: string; status: string; detail?: string; ms?: number }>;
      generated?: { blog_post: string; image_prompt: string };
      image_url?: string;
      image_model?: string;
      total_ms: number;
    }>('/api/jobs/content-preview', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 180_000,
    }),
  publishFromPreview: (jobId: string) =>
    request<{
      success: boolean;
      blog_job_id: string;
      jobs_created: number;
      video_queue_id?: string;
    }>(`/api/jobs/${jobId}/publish-from-preview`, { method: 'POST' }),
  pauseJob: (id: string) => request(`/api/jobs/${id}/pause`, { method: 'PATCH' }),
  resumeJob: (id: string) => request(`/api/jobs/${id}/resume`, { method: 'PATCH' }),
  deleteJob: async (id: string) => {
    const res = await request(`/api/jobs/${id}`, { method: 'DELETE' });
    refreshNavCaches();
    return res;
  },
  bulkDeleteJobs: (ids: string[]) =>
    request<{ success: boolean; deleted: number; failed: number; errors?: string[] }>(
      '/api/jobs/bulk-delete',
      { method: 'POST', body: JSON.stringify({ ids }) },
    ),
  crankJobSession: (id: string) =>
    request<{
      crank_workspace: string;
      service_label: string;
      crank_label: string | null;
      our_blog_targets: string[];
      our_activity: Array<{ url: string; type: string; at: string; title: string | null }>;
      other_activity: Array<{ url: string; type: string; at: string; title: string | null }>;
      session_started: boolean;
    }>(`/api/jobs/${id}/crank-session`),
  runJob: (id: string) => request(`/api/jobs/${id}/run-now`, { method: 'POST' }),
  updateJob: async (id: string, body: Partial<HumaJob>) => {
    const job = await request<HumaJob>(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    refreshNavCaches();
    return job;
  },
  navBadges: (params?: { workspace?: string }, opts?: { force?: boolean }) =>
    cachedFetch(
      `nav-badges:${params?.workspace ?? 'all'}`,
      10_000,
      () =>
        request<{ queue: number; video: number; watcher: number }>(
          `/api/jobs/nav-badges${qs(params ?? {})}`,
        ),
      opts,
    ),
  accounts: (opts?: { force?: boolean }) =>
    cachedFetch('accounts', 15_000, () => request<HumaAccount[]>('/api/accounts'), opts),
  createAccount: (body: Record<string, unknown>) =>
    request('/api/accounts', { method: 'POST', body: JSON.stringify(body) }),
  updateAccount: (id: string, body: Record<string, unknown>) =>
    request(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  updateAccountBlogPersona: async (
    id: string,
    text: string,
    proxyPort?: number,
    existingPersona?: Record<string, unknown> | null,
  ) => {
    const path = `/api/accounts/${encodeURIComponent(id)}`;
    const primary = { blog_writing_persona: text, lookup_proxy_port: proxyPort };
    try {
      return await request<HumaAccount>(path, {
        method: 'PATCH',
        body: JSON.stringify(primary),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      const needsFallback =
        msg.includes('변경할 필드') ||
        msg.includes('blog_writing_persona') ||
        msg.includes('API 경로 없음');
      if (!needsFallback) throw e;
      const { mergeBlogWritingPersona } = await import('./blog-writing-persona');
      return request<HumaAccount>(path, {
        method: 'PATCH',
        body: JSON.stringify({
          persona: mergeBlogWritingPersona(existingPersona ?? null, text),
        }),
      });
    }
  },
  deleteAccount: (id: string) => request(`/api/accounts/${id}`, { method: 'DELETE' }),
  accountLogs: (id: string) => request(`/api/accounts/${id}/logs`),
  modems: (opts?: { probe?: boolean; slots?: number[]; timeoutMs?: number; force?: boolean }) => {
    const path = `/api/modems${qs({
      probe: opts?.probe ? '1' : undefined,
      slots: opts?.slots?.length ? opts.slots.join(',') : undefined,
    })}`;
    const fetcher = () =>
      request<HumaModem[]>(path, {
        timeoutMs: opts?.timeoutMs ?? (opts?.probe ? 180_000 : undefined),
      });
    if (opts?.probe) return fetcher();
    return cachedFetch('modems:db', 30_000, fetcher, { force: opts?.force });
  },
  reconnectModem: async (id: string) => {
    invalidateApiCache('modems');
    return request(`/api/modems/${id}/reconnect`, { method: 'POST' });
  },
  restoreModemNetwork: async () => {
    invalidateApiCache('modems');
    return request<{ success: boolean; message?: string; output?: string; error?: string }>(
      '/api/modems/restore-network',
      { method: 'POST', timeoutMs: 200_000 },
    );
  },
  logs: (params?: { level?: string; platform?: string; limit?: string }) =>
    request<Array<Record<string, unknown>>>(`/api/logs${qs(params ?? {})}`),
  videoQueue: () => request<HumaVideoQueue[]>('/api/video/queue'),
  createVideo: (body: Record<string, unknown>) =>
    request('/api/video/generate', { method: 'POST', body: JSON.stringify(body) }),
  settings: () => request<Array<{ key: string; value: unknown }>>('/api/settings'),
  getSetting: (key: string) => request<Record<string, unknown>>(`/api/settings/${key}`),
  updateSetting: (key: string, value: unknown) =>
    request(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify(value) }),
  platformAccounts: () => request<Array<Record<string, unknown>>>('/api/platform-accounts'),
  createPlatformAccount: (body: Record<string, unknown>) =>
    request('/api/platform-accounts', { method: 'POST', body: JSON.stringify(body) }),
  updatePlatformAccount: (id: string, body: Record<string, unknown>) =>
    request(`/api/platform-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deletePlatformAccount: (id: string) =>
    request(`/api/platform-accounts/${id}`, { method: 'DELETE' }),
  dashboardStats: (params?: { period?: 'today' | 'week' | 'month' }) =>
    request<{
      pendingJobs: number;
      activeAccounts: number;
      errors: number;
      todayCompleted: number;
      serviceStats: Array<{ workspace: string; todayJobs: number; pending: number; errors: number; running?: number }>;
      chart: Array<{ day: string; value: number }>;
      period?: 'today' | 'week' | 'month';
      chartLabel?: string;
      nextPublish?: string | null;
      integrated: {
        todayPublish: number;
        todayPublishSub: string;
        queuePending: number;
        queueSub: string;
        errors: number;
        errorsSub: string;
        activeAccounts: number;
        totalAccounts: number;
        accountSub: string;
      };
      serviceStatus: Record<
        string,
        { icon: string; name: string; detail: string; todayJobs: number; jobsLabel: string; status: 'ok' | 'warn' | 'err' }
      >;
      workspacePosts: Record<
        string,
        Array<{
          title: string;
          meta: string;
          status: 'done' | 'running' | 'idle' | 'error' | 'warn';
          statusLabel: string;
          urlKind: 'link' | 'generating' | 'dash' | 'watcher';
          url?: string;
        }>
      >;
      roasItems: Array<{ title: string; platform: string; views: number }>;
      yeonunSocial: Array<{ label: string; current: number; max: number | null }>;
      pananaStats: { todayPosts: number; activePlatforms: number; errorAccounts: number };
    }>(`/api/dashboard/stats${qs({ period: params?.period })}`),
  monitorSessions: () =>
    request<{
      live: Array<{
        jobId: string;
        account: string;
        platform: string;
        workspace: string;
        title: string;
        chars: number;
        totalChars: number;
        wpm: number;
        typos: number;
        eta: string;
        preview: string;
      }>;
      idle: {
        jobId: string;
        account: string;
        schedule: string;
        title: string;
        workspace: string;
        platform: string | null;
      } | null;
      errors: Array<{
        kind: 'platform' | 'job';
        account: string;
        platform: string;
        workspace: string;
        detail: string;
        sub: string;
      }>;
    }>('/api/monitor/sessions'),
  crankFeed: () =>
    request<{
      kpi: {
        visit: { current: number; max: number };
        like: { current: number; max: number };
        comment: { current: number; max: number };
        neighbor: { current: number; max: number };
      };
      accountCards: Array<{ id: string; label: string; count: number; sub: string }>;
      feed: Array<{
        id: string;
        acct: string;
        type: '방문' | '공감' | '댓글' | '이웃';
        title: string;
        sub: string;
        time: string;
        expand?: string;
      }>;
      keywords: string[];
      hasData?: boolean;
    }>('/api/crank/feed', {
      sameOrigin: typeof window === 'undefined' ? false : true,
      cache: 'no-store',
    }),
  seoKeywords: (workspace: string) =>
    request<{
      workspace: string;
      badge: string;
      configured: boolean;
      missingEnv?: string[];
      source: string;
      ranks: Array<{ rank: string; word: string; vol: string; chg: string; ok: boolean | null }>;
      pool: string[];
      table: Array<{ id: string; kw: string; cnt: number; reflect: string; st: string; tone: 'ok' | 'warn' | 'err' }>;
      crawledAt?: string;
      cachedAt?: string;
    }>(`/api/seo/keywords?workspace=${encodeURIComponent(workspace)}`),
  crawlSeo: (workspace: string) =>
    request(`/api/seo/crawl?workspace=${encodeURIComponent(workspace)}`, { method: 'POST' }),
  cafeViralKpi: () =>
    request<{
      crawled: { value: number; sub: string };
      today: { value: number; sub: string; tone?: 'ok' };
      selfQa: { value: number; sub: string };
      organic: { value: number; sub: string; tone?: 'ok' };
    }>('/api/cafe-viral/kpi'),
  dashboardRecent: () =>
    request<Array<{ title: string; status: string; result_url?: string; workspace: string; completed_at?: string }>>(
      '/api/dashboard/recent'
    ),
  calendarJobs: (params?: { month?: string; workspace?: string }) =>
    request<
      Array<{
        id: string;
        title: string;
        job_type: string;
        status: string;
        scheduled_at: string;
        workspace: string;
        result_url?: string | null;
        completed_at?: string | null;
        content?: string | null;
        image_urls?: string[] | null;
        platform?: string | null;
      }>
    >(`/api/jobs/calendar${qs(params ?? {})}`),
  crankScheduler: (opts?: { probe?: boolean }) =>
    request<{
      date_key: string;
      active_crank_modems: number;
      cycle_days: number;
      daily_account_target: number;
      max_sessions_per_modem_per_day: number;
      today_scheduled: number;
      today_completed: number;
      session_duration_minutes: number;
      modems: Array<Record<string, unknown>>;
      accounts: Array<Record<string, unknown>>;
    }>(`/api/crank/scheduler${qs({ probe: opts?.probe ? '1' : undefined })}`, {
      // probe는 프록시 관리와 동일하게 i7 직접 호출 (Next 프록시 18초 타임아웃 회피)
      sameOrigin: opts?.probe ? false : typeof window !== 'undefined',
      cache: 'no-store',
      timeoutMs: opts?.probe ? 25_000 : 10_000,
    }),
  cafeTargets: () => request<Array<Record<string, unknown>>>('/api/cafe/targets'),
  crawlCafe: () => request<{ success: boolean; count: number }>('/api/cafe/crawl', { method: 'POST' }),
  cafeViralCafes: () => request<Array<Record<string, unknown>>>('/api/cafe-viral/cafes'),
  createCafeViral: (body: Record<string, unknown>) =>
    request('/api/cafe-viral/cafes', { method: 'POST', body: JSON.stringify(body) }),
  updateCafeViral: (id: string, body: Record<string, unknown>) =>
    request(`/api/cafe-viral/cafes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  scanCafeViral: (cafeId: string) =>
    request<{ success: boolean; count: number }>(`/api/cafe-viral/cafes/${cafeId}/scan`, { method: 'POST' }),
  cafeViralPosts: (status?: string) =>
    request<Array<Record<string, unknown>>>(`/api/cafe-viral/posts${status ? `?status=${status}` : ''}`),
  replyCafeViralPost: (postId: string, accountId?: string) =>
    request(`/api/cafe-viral/posts/${postId}/reply`, {
      method: 'POST',
      body: JSON.stringify(accountId ? { account_id: accountId } : {}),
    }),
  runCafeDailyActivity: (body: { account_id: string; cafe_id: string; workspace: string }) =>
    request('/api/cafe-viral/activity/daily', { method: 'POST', body: JSON.stringify(body) }),
  cafeViralActivityStats: (cafeId: string) =>
    request<{ cafe_name?: string; activity_ratio: { daily_reply: number; self_qa: number }; today: { daily_reply: number; self_qa: number } }>(
      `/api/cafe-viral/activity/stats?cafe_id=${encodeURIComponent(cafeId)}`,
    ),
  detectCafeGrade: (cafeId: string) =>
    request(`/api/cafe-viral/cafes/${cafeId}/detect-grade`, { method: 'POST' }),
  adsenseStats: (workspace: string) =>
    request<{
      configured: boolean;
      missingEnv?: string[];
      todayEarnings: number;
      yesterdayEarnings: number;
      monthEarnings: number;
      monthPageViews: number;
      monthClicks: number;
      monthImpressions: number;
      cpc: number;
      ctr: number;
      rpm: number;
      unpaidBalance: number;
      unpaidBalanceFormatted: string;
      combinedTotal: number;
      last7Days: {
        clicks: { current: number; previous: number; change: number; changePct: number };
        pageViews: { current: number; previous: number; change: number; changePct: number };
        impressions: { current: number; previous: number; change: number; changePct: number };
        cpc: { current: number; previous: number; change: number; changePct: number };
        rpm: { current: number; previous: number; change: number; changePct: number };
        ctr: { current: number; previous: number; changePp: number; changePct: number };
      };
      monthlyTrend: Array<{ month: string; earnings: number; pageViews: number; rpm: number }>;
    }>(`/api/publisher-stats?workspace=${encodeURIComponent(workspace)}`, { sameOrigin: true }),
  stopAll: (reason: string) =>
    request('/api/stop-all', { method: 'POST', body: JSON.stringify({ reason }) }),
  advanceJob: (id: string) => request(`/api/jobs/${id}/advance`, { method: 'PATCH' }),
  resumeAll: () => request('/api/resume-all', { method: 'POST' }),
};
