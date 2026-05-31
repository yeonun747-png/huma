import type { HumaJob, HumaAccount, HumaModem, HumaVideoQueue } from '@huma/shared';

const API_BASE = process.env.NEXT_PUBLIC_HUMA_API_URL ?? 'http://localhost:3100';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('huma_token');
}

type RequestOptions = RequestInit & { sameOrigin?: boolean };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { sameOrigin, ...fetchOptions } = options;
  const token = getToken();
  const hasBody = fetchOptions.body !== undefined && fetchOptions.body !== null && fetchOptions.body !== '';
  const headers: Record<string, string> = {
    ...(fetchOptions.headers as Record<string, string>),
  };
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (token) headers['X-HUMA-KEY'] = token;

  const url = sameOrigin ? path : `${API_BASE}${path}`;

  const res = await fetch(url, { ...fetchOptions, headers }).catch(() => {
    const hint = !sameOrigin && (path.includes('adsense') || path.includes('monetization'))
      ? ' 브라우저 광고 차단 확장 프로그램이 API 요청을 막았을 수 있습니다.'
      : '';
    throw new Error(
      `API 서버에 연결할 수 없습니다 (${sameOrigin ? '동일 출처 프록시' : API_BASE}). i7 서버·Cloudflare Tunnel 실행 여부와 NEXT_PUBLIC_HUMA_API_URL을 확인하세요.${hint}`,
    );
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('huma_token');
      window.dispatchEvent(new Event('huma:auth-expired'));
    }
    throw new Error(err.error ?? 'API 요청 실패');
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

export const api = {
  health: () => request<{ status: string }>('/api/health'),
  status: () => request<{
    healthy: boolean;
    queueActive: boolean;
    pendingJobs: number;
    activeAccounts: number;
    errors: number;
    paused: boolean;
  }>('/api/status'),
  login: (username: string, password: string) =>
    request<{
      token: string;
      admin: { name: string; email: string; workspaces: string[]; isSuper?: boolean };
    }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request<{ adminId: string; email: string; workspaces: string[]; isSuper: boolean }>('/api/auth/me'),
  jobs: (params?: { status?: string; workspace?: string; platform?: string }) =>
    request<HumaJob[]>(`/api/jobs${qs(params ?? {})}`),
  createJob: (body: Partial<HumaJob>) =>
    request<HumaJob>('/api/jobs', { method: 'POST', body: JSON.stringify(body) }),
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
  }) =>
    request<HumaJob>('/api/jobs/auto-content', { method: 'POST', body: JSON.stringify(body) }),
  pauseJob: (id: string) => request(`/api/jobs/${id}/pause`, { method: 'PATCH' }),
  resumeJob: (id: string) => request(`/api/jobs/${id}/resume`, { method: 'PATCH' }),
  deleteJob: (id: string) => request(`/api/jobs/${id}`, { method: 'DELETE' }),
  runJob: (id: string) => request(`/api/jobs/${id}/run-now`, { method: 'POST' }),
  updateJob: (id: string, body: Partial<HumaJob>) =>
    request<HumaJob>(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  navBadges: () => request<{ queue: number; video: number; watcher: number }>('/api/jobs/nav-badges'),
  accounts: () => request<HumaAccount[]>('/api/accounts'),
  createAccount: (body: Record<string, unknown>) =>
    request('/api/accounts', { method: 'POST', body: JSON.stringify(body) }),
  updateAccount: (id: string, body: Record<string, unknown>) =>
    request(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAccount: (id: string) => request(`/api/accounts/${id}`, { method: 'DELETE' }),
  accountLogs: (id: string) => request(`/api/accounts/${id}/logs`),
  modems: () => request<HumaModem[]>('/api/modems'),
  reconnectModem: (id: string) => request(`/api/modems/${id}/reconnect`, { method: 'POST' }),
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
  dashboardStats: () =>
    request<{
      pendingJobs: number;
      activeAccounts: number;
      errors: number;
      todayCompleted: number;
      serviceStats: Array<{ workspace: string; todayJobs: number; pending: number; errors: number }>;
      chart: Array<{ day: string; value: number }>;
    }>('/api/dashboard/stats'),
  dashboardRecent: () =>
    request<Array<{ title: string; status: string; result_url?: string; workspace: string; completed_at?: string }>>(
      '/api/dashboard/recent'
    ),
  calendarJobs: (params?: { month?: string; workspace?: string }) =>
    request<Array<{ id: string; title: string; job_type: string; status: string; scheduled_at: string; workspace: string }>>(
      `/api/jobs/calendar${qs(params ?? {})}`
    ),
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
  stopAll: () => request('/api/stop-all', { method: 'POST' }),
  resumeAll: () => request('/api/resume-all', { method: 'POST' }),
};
