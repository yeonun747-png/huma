import type { HumaJob, HumaAccount, HumaModem, HumaVideoQueue, HumaBgmLibrary } from '@huma/shared';

const API_BASE = process.env.NEXT_PUBLIC_HUMA_API_URL ?? 'http://localhost:3100';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('huma_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['X-HUMA-KEY'] = token;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers }).catch(() => {
    throw new Error(`API 서버에 연결할 수 없습니다 (${API_BASE}). npm run dev:server 실행 및 .env 설정을 확인하세요.`);
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
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
  bgmList: (params?: { workspace?: string; mood?: string }) =>
    request<HumaBgmLibrary[]>(`/api/bgm${qs(params ?? {})}`),
  createBgm: (body: Record<string, unknown>) =>
    request('/api/bgm', { method: 'POST', body: JSON.stringify(body) }),
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
  adsenseStats: (workspace: string) =>
    request<{
      configured: boolean;
      todayEarnings: number;
      monthEarnings: number;
      monthPageViews: number;
      rpm: number;
      monthlyTrend: Array<{ month: string; earnings: number; pageViews: number; rpm: number }>;
    }>(`/api/adsense/stats?workspace=${encodeURIComponent(workspace)}`),
  stopAll: () => request('/api/stop-all', { method: 'POST' }),
  resumeAll: () => request('/api/resume-all', { method: 'POST' }),
};
