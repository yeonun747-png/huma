import type { HumaJob, HumaAccount, HumaModem, HumaVideoQueue, HumaVideoContentHistory } from '@huma/shared';
import { cachedFetch, invalidateApiCache } from '@/lib/api-cache';
import { refreshNavBadges } from '@/lib/nav-badge-events';

const API_BASE = process.env.NEXT_PUBLIC_HUMA_API_URL ?? 'http://localhost:3100';

function resolveRequestUrl(path: string, sameOrigin?: boolean): string {
  const apiPath = path.startsWith('/') ? path : `/${path}`;
  if (sameOrigin && typeof window !== 'undefined') {
    return new URL(apiPath, window.location.origin).href;
  }
  if (sameOrigin) return apiPath;
  // 브라우저 — Vercel/로컬 동일 출처 프록시 → i7 (LAN IP·CORS·혼합콘텐츠 회피)
  if (typeof window !== 'undefined') {
    const proxyPath = apiPath.replace(/^\/api\//, '');
    return new URL(`/api/huma/${proxyPath}`, window.location.origin).href;
  }
  return `${API_BASE}${apiPath}`;
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
        ? `${window.location.origin} (동일 출처)`
        : '동일 출처 프록시'
      : typeof window !== 'undefined'
        ? `${window.location.origin}/api/huma → HUMA_API_URL`
        : API_BASE;
    const isTimeout =
      err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'TimeoutError');
    if (isTimeout) {
      const sec = timeoutMs != null ? Math.round(timeoutMs / 1000) : 20;
      throw new Error(
        `요청 시간 초과(${sec}초). ${target}${hint}`,
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
      ok?: boolean;
    };
    if (res.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('huma_token');
      window.dispatchEvent(new Event('huma:auth-expired'));
    }
    const parts = [err.error, err.message].filter(
      (s): s is string => typeof s === 'string' && s.trim().length > 0 && s !== 'Not Found',
    );
    const detail = [...new Set(parts)].join(' — ');
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
  invalidateApiCache('jobs-page');
  invalidateApiCache('dashboard:');
  refreshNavBadges();
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
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      timeoutMs: 20_000,
    }),
  me: () => request<{ adminId: string; email: string; workspaces: string[]; isSuper: boolean }>('/api/auth/me'),
  jobs: (params?: {
    status?: string;
    workspace?: string;
    platform?: string;
    job_type?: string;
    limit?: string;
  }) => request<HumaJob[]>(`/api/jobs${qs(params ?? {})}`),
  jobsPage: (
    params: { workspace: string; limit?: string; offset?: string },
    opts?: { force?: boolean },
  ) =>
    cachedFetch(
      `jobs-page:${params.workspace}:${params.limit ?? '50'}:${params.offset ?? '0'}`,
      4_000,
      () =>
        request<{
          items: HumaJob[];
          total: number;
          stats: { pending: number; running: number; doneToday: number; doneAll: number };
        }>(`/api/jobs/page${qs(params)}`),
      opts,
    ),
  createJob: async (body: Partial<HumaJob>) => {
    const job = await request<HumaJob>('/api/jobs', { method: 'POST', body: JSON.stringify(body) });
    refreshNavCaches();
    return job;
  },
  createAutoContentJob: (body: {
    workspace: string;
    account_id?: string;
    title?: string;
    source_url?: string;
    synopsis?: string;
    uploaded_images?: string[];
    screenshot_base64?: string;
    content_type?: 'A' | 'B';
    content_type_auto?: boolean;
    auto_schedule?: boolean;
    schedule_time?: string;
    repeat_rule?: string;
    dry_run?: boolean;
  }) =>
    request<HumaJob>('/api/jobs/auto-content', { method: 'POST', body: JSON.stringify(body) }),
  getAutoPublishStatus: (workspace: string) =>
    request<{
      workspace: string;
      account_id?: string;
      account_label?: string;
      today_completed: number;
      today_skipped?: number;
      daily_target: number;
      auto_publish_enabled?: boolean;
      auto_publish_planned_count?: number | null;
      auto_publish_next_slot_at?: string | null;
      weekday_base: number;
      remaining: number;
      hard_cap: number;
      can_publish: boolean;
      block_reason?: string;
      block_message?: string;
      auto_pick_ready: boolean;
      is_weekend: boolean;
      weekend_ratio?: number;
    }>(`/api/jobs/auto-publish/status?workspace=${encodeURIComponent(workspace)}`),
  getAutoPublishAccountsStatus: (workspace: string) =>
    request<{ accounts: Array<{
      workspace: string;
      account_id?: string;
      account_label?: string;
      today_completed: number;
      today_skipped?: number;
      daily_target: number;
      auto_publish_enabled?: boolean;
      auto_publish_planned_count?: number | null;
      auto_publish_next_slot_at?: string | null;
      proxy_port?: number | null;
      weekday_base: number;
      remaining: number;
      hard_cap: number;
      can_publish: boolean;
      block_reason?: string;
      block_message?: string;
      auto_pick_ready: boolean;
      is_weekend: boolean;
      weekend_ratio?: number;
    }> }>(`/api/jobs/auto-publish/accounts?workspace=${encodeURIComponent(workspace)}`),
  runAutoPublish: (workspace: string, accountId?: string) =>
    request<{
      ok: boolean;
      enabled: boolean;
      planned_count?: number;
      remaining_today?: number;
      next_slot_at?: string | null;
      _meta?: {
        daily_status?: {
          workspace: string;
          account_id?: string;
          account_label?: string;
          today_completed: number;
          today_skipped?: number;
          daily_target: number;
          auto_publish_enabled?: boolean;
          auto_publish_planned_count?: number | null;
        };
        accounts_status?: unknown[];
      };
    }>('/api/jobs/auto-publish', {
      method: 'POST',
      body: JSON.stringify({ workspace, ...(accountId ? { account_id: accountId } : {}) }),
    }),
  toggleAutoPublish: (workspace: string, enabled: boolean, accountId?: string) =>
    request<{
      ok: boolean;
      enabled: boolean;
      planned_count?: number;
      remaining_today?: number;
      next_slot_at?: string | null;
      _meta?: {
        daily_status?: Record<string, unknown>;
        accounts_status?: unknown[];
      };
    }>('/api/jobs/auto-publish', {
      method: 'POST',
      body: JSON.stringify({
        workspace,
        enabled,
        ...(accountId ? { account_id: accountId } : {}),
      }),
    }),
  uploadJobSlotImage: (body: { workspace: string; slot_index: number; image_data: string }) =>
    request<{ url: string }>('/api/jobs/upload-image', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 120_000,
    }),
  getJob: (id: string) => request<HumaJob>(`/api/jobs/${id}`),
  getCaptchaHold: (id: string) =>
    request<{
      job_status: string;
      hold: {
        active: boolean;
        expiresAt?: string;
        captchaScreenshotUpdatedAt?: number;
        hasCaptchaScreenshot?: boolean;
        captchaRound?: number;
      } | null;
      vnc_url?: string | null;
      web_url?: string | null;
    }>(`/api/jobs/${id}/captcha-hold`),
  fetchCaptchaScreenshotObjectUrl: async (jobId: string, updatedAt?: number): Promise<string | null> => {
    const token = getToken();
    const q = updatedAt ? `?t=${updatedAt}` : '';
    const res = await fetch(`${API_BASE}/api/jobs/${jobId}/captcha-screenshot${q}`, {
      headers: token ? { 'X-HUMA-KEY': token } : {},
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  submitCaptchaAnswer: (id: string, answer: string) =>
    request<{
      ok: boolean;
      submitted: boolean;
      captcha_cleared: boolean;
      pending_login?: boolean;
      captcha_still_visible?: boolean;
      auto_resumed?: boolean;
      hold?: {
        captchaScreenshotUpdatedAt?: number;
        hasCaptchaScreenshot?: boolean;
        captchaRound?: number;
      } | null;
    }>(`/api/jobs/${id}/captcha-answer`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
      timeoutMs: 45_000,
    }),
  completeCaptchaJob: async (id: string, resultUrl?: string) => {
    const res = await request<HumaJob>(`/api/jobs/${id}/captcha-complete`, {
      method: 'POST',
      body: JSON.stringify(resultUrl ? { result_url: resultUrl } : {}),
    });
    refreshNavCaches();
    return res;
  },
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
    title?: string;
    source_url?: string;
    synopsis?: string;
    uploaded_images?: string[];
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
  abortJob: async (id: string, opts?: { delete?: boolean }) => {
    const res = await request<{ success: boolean; deleted: boolean }>(`/api/jobs/${id}/abort`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    });
    refreshNavCaches();
    return res;
  },
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
    request('/api/accounts', { method: 'POST', body: JSON.stringify(body) }).then((r) => {
      invalidateApiCache('accounts');
      return r;
    }),
  updateAccount: (id: string, body: Record<string, unknown>) =>
    request(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }).then((r) => {
      invalidateApiCache('accounts');
      return r;
    }),
  deleteAccount: (id: string) =>
    request(`/api/accounts/${id}`, { method: 'DELETE' }).then((r) => {
      invalidateApiCache('accounts');
      return r;
    }),
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
  accountLogs: (id: string) => request(`/api/accounts/${id}/logs`),
  startPostingRemoteAccess: (accountId: string) =>
    request<{
      ok: true;
      accountId: string;
      accountName: string;
      proxyPort: number;
      slotLabel: string | null;
      vncUrl: string | null;
      reused: boolean;
    }>(`/api/accounts/${encodeURIComponent(accountId)}/remote-access`, {
      method: 'POST',
      timeoutMs: 120_000,
    }),
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
  logs: (params?: { level?: string; platform?: string; limit?: string }, opts?: { force?: boolean }) =>
    cachedFetch(
      `logs:${params?.level ?? 'all'}:${params?.platform ?? 'all'}:${params?.limit ?? '50'}`,
      10_000,
      () => request<Array<Record<string, unknown>>>(`/api/logs${qs(params ?? {})}`),
      opts,
    ),
  videoQueue: () => request<HumaVideoQueue[]>('/api/video/queue'),
  createVideo: (body: Record<string, unknown>) =>
    request('/api/video/generate', { method: 'POST', body: JSON.stringify(body) }),
  videoContentList: (params?: { account_id?: string; workspace?: string }, opts?: { force?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.account_id) q.set('account_id', params.account_id);
    if (params?.workspace) q.set('workspace', params.workspace);
    const qsStr = q.toString();
    return cachedFetch(
      `video-content:${params?.workspace ?? 'all'}:${params?.account_id ?? 'all'}`,
      5_000,
      () => request<HumaVideoContentHistory[]>(`/api/video-content${qsStr ? `?${qsStr}` : ''}`),
      opts,
    );
  },
  videoContentGet: (id: string) => request<HumaVideoContentHistory>(`/api/video-content/${id}`),
  videoContentHistory: (accountId: string) =>
    request<HumaVideoContentHistory[]>(`/api/accounts/${accountId}/video-content-history`),
  getWorkspaceVideoPersona: (workspace: string) =>
    request<{ workspace: string; personaText: string; requiredHeaders: string[] }>(
      `/api/workspaces/${workspace}/video-persona`,
    ),
  updateWorkspaceVideoPersona: (workspace: string, body: { personaText: string }) =>
    request<{ ok: boolean; missingSections: string[] }>(`/api/workspaces/${workspace}/video-persona`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  generateConti: (accountId: string) =>
    request<{ ok: boolean; message?: string }>(`/api/accounts/${accountId}/generate-conti`, {
      method: 'POST',
    }),
  renderVideoContent: (historyId: string) =>
    request<{ ok: boolean; message?: string }>(`/api/video-content/${historyId}/render-video`, {
      method: 'POST',
    }),
  cancelVideoContent: (historyId: string) =>
    request<{ ok: boolean; previousStatus?: string }>(`/api/video-content/${historyId}/cancel`, {
      method: 'POST',
    }),
  reburnVideoSubtitles: (historyId: string) =>
    request<{ ok: boolean; message?: string }>(`/api/video-content/${historyId}/reburn-subtitles`, {
      method: 'POST',
    }),
  deleteVideoContentFile: (id: string, target: 'source' | 'subtitled') =>
    request<{ ok: boolean; deleted: string; historyRemoved?: boolean }>(
      `/api/video-content/${id}/video-file?target=${encodeURIComponent(target)}`,
      { method: 'DELETE' },
    ),
  videoContentStorageStats: (workspace?: string) => {
    const qs = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    return request<{
      stats: import('@/lib/video-content-storage').VideoContentStorageStats;
      settings: import('@/lib/video-content-storage').VideoContentStorageSettings;
    }>(`/api/video-content/storage/stats${qs}`);
  },
  videoContentStorageItems: (params?: { workspace?: string; filter?: string }) => {
    const q = new URLSearchParams();
    if (params?.workspace) q.set('workspace', params.workspace);
    if (params?.filter) q.set('filter', params.filter);
    const qs = q.toString();
    return request<import('@/lib/video-content-storage').VideoContentStorageItem[]>(
      `/api/video-content/storage/items${qs ? `?${qs}` : ''}`,
    );
  },
  videoContentStorageBulkDelete: (ids: string[], target: 'source' | 'subtitled') =>
    request<{ ok: boolean; deleted: number; freedBytes: number }>(
      '/api/video-content/storage/bulk-delete',
      { method: 'POST', body: JSON.stringify({ ids, target }) },
    ),
  getVideoContentStorageSettings: () =>
    request<import('@/lib/video-content-storage').VideoContentStorageSettings>(
      '/api/video-content/storage/settings',
    ),
  updateVideoContentStorageSettings: (body: Partial<import('@/lib/video-content-storage').VideoContentStorageSettings>) =>
    request<{ ok: boolean; settings: import('@/lib/video-content-storage').VideoContentStorageSettings }>(
      '/api/video-content/storage/settings',
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  runVideoContentStorageCleanup: () =>
    request<{ ok: boolean; deletedSources: number; deletedSubtitled: number; freedBytes: number }>(
      '/api/video-content/storage/run-cleanup',
      { method: 'POST' },
    ),
  /** @deprecated generateConti 사용 */
  generateVideoContent: (accountId: string) =>
    request<{ ok: boolean; message?: string }>(`/api/accounts/${accountId}/generate-conti`, {
      method: 'POST',
    }),
  updateVideoContentUpload: (id: string, body: Record<string, boolean>) =>
    request(`/api/video-content/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  updateVideoContentShotDialogues: (
    id: string,
    dialogues: Array<{ shotNumber: number; dialogue: string }>,
  ) =>
    request<HumaVideoContentHistory>(`/api/video-content/${id}/conti-dialogues`, {
      method: 'PATCH',
      body: JSON.stringify({ dialogues }),
    }),
  deleteVideoContent: (id: string) =>
    request<{ ok: boolean }>(`/api/video-content/${id}`, { method: 'DELETE' }),
  fetchVideoContentBlob: async (id: string, variant?: 'source' | 'subtitled'): Promise<Blob> => {
    const token = getToken();
    const qs = variant === 'source' ? '?variant=source' : '';
    const res = await fetch(`${API_BASE}/api/video-content/${id}/stream${qs}`, {
      headers: token ? { 'X-HUMA-KEY': token } : {},
    });
    if (!res.ok) throw new Error(variant === 'source' ? '원본 로드 실패' : '영상 로드 실패');
    return res.blob();
  },
  fetchVideoContentThumbnail: async (id: string, variant: 'source' | 'subtitled'): Promise<Blob> => {
    const token = getToken();
    const qs = variant === 'source' ? '?variant=source' : '';
    const res = await fetch(`${API_BASE}/api/video-content/${id}/thumbnail${qs}`, {
      headers: token ? { 'X-HUMA-KEY': token } : {},
    });
    if (!res.ok) throw new Error('썸네일 로드 실패');
    return res.blob();
  },
  downloadVideoContent: async (id: string, variant?: 'source' | 'subtitled') => {
    const token = getToken();
    const qs = variant === 'source' ? '?variant=source' : '';
    const res = await fetch(`${API_BASE}/api/video-content/${id}/download${qs}`, {
      headers: token ? { 'X-HUMA-KEY': token } : {},
    });
    if (!res.ok) throw new Error('다운로드 실패');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `huma-video-${id}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
  },
  pananaCharacters: (accountId?: string) => {
    const q = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
    return request<{
      characters: Array<{ id: string; name: string; description?: string | null; appearanceCount?: number }>;
      lastSyncedAt: string | null;
    }>(`/api/panana-characters${q}`);
  },
  syncPananaCharacters: () =>
    request<{ synced: number; error?: string }>('/api/panana-characters/sync', { method: 'POST' }),
  quizContent: () =>
    request<{
      quizzes: Array<{
        id: string;
        quiz_external_id: string;
        slug: string | null;
        title: string;
        description: string | null;
        status: string;
        usageCount?: number;
      }>;
      lastSyncedAt: string | null;
    }>('/api/quiz-content'),
  syncQuizContent: () =>
    request<{ synced: number; error?: string }>('/api/quiz-content/sync', { method: 'POST' }),
  settings: () => request<Array<{ key: string; value: unknown }>>('/api/settings'),
  getSetting: (key: string) => request<Record<string, unknown>>(`/api/settings/${key}`),
  updateSetting: (key: string, value: unknown) =>
    request(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify(value) }),
  getPostingWarmupStatus: () =>
    request<{
      accounts: Array<{
        dongle_label: string;
        slot_label: string;
        workspace: string;
        proxy_port: number;
        account_id: string | null;
        warmup_day: number;
        phase_label: string;
        stage: string;
        weekday_cap: number | null;
        today_target: number | null;
        is_complete: boolean;
        missing: boolean;
      }>;
      is_super?: boolean;
    }>('/api/posting/warmup-status'),
  getPostingAccounts: (workspace: string) =>
    request<{
      accounts: Array<{ id: string; label?: string; proxy_port?: number }>;
    }>(`/api/posting/accounts?workspace=${encodeURIComponent(workspace)}`),
  getPostingDongles: (workspace?: string) =>
    request<{
      dongles: Array<{
        slot: number;
        label: string;
        proxy_port: number;
        workspace: string;
        account_count: number;
        max_accounts: number;
        accounts: Array<Record<string, unknown>>;
      }>;
    }>(`/api/posting/dongles${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''}`),
  platformAccounts: () => request<Array<Record<string, unknown>>>('/api/platform-accounts'),
  createPlatformAccount: (body: Record<string, unknown>) =>
    request('/api/platform-accounts', { method: 'POST', body: JSON.stringify(body) }),
  updatePlatformAccount: (id: string, body: Record<string, unknown>) =>
    request(`/api/platform-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deletePlatformAccount: (id: string) =>
    request(`/api/platform-accounts/${id}`, { method: 'DELETE' }),
  dashboardStats: (params?: { period?: 'today' | 'week' | 'month' }, opts?: { force?: boolean }) =>
    cachedFetch(
      `dashboard:${params?.period ?? 'today'}`,
      20_000,
      () =>
        request<{
          pendingJobs: number;
          activeAccounts: number;
          errors: number;
          todayCompleted: number;
          serviceStats: Array<{ workspace: string; todayJobs: number; pending: number; errors: number; running?: number }>;
          chart: Array<{ day: string; value: number; isToday?: boolean }>;
          chartAverage?: number;
          period?: 'today' | 'week' | 'month';
          chartLabel?: string;
          nextPublish?: string | null;
          nextPublishAt?: string | null;
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
          roasItems: Array<{
            title: string;
            blogUrl: string;
            landingUrl: string;
            clicks: number;
            impressions: number;
          }>;
          roasMeta: {
            configured: boolean;
            periodDays: number;
            missingEnv?: string[];
          };
          yeonunSocial: Array<{ label: string; current: number; max: number | null }>;
          pananaStats: { todayPosts: number; activePlatforms: number; errorAccounts: number };
        }>(`/api/dashboard/stats${qs({ period: params?.period })}`),
      opts,
    ),
  monitorSessions: () =>
    request<{
      live: Array<
        | {
            kind: 'posting';
            jobId: string;
            account: string;
            platform: string;
            workspace: string;
            title: string;
            jobType: string;
            jobStatus: string;
            elapsedMin: number;
            chars: number;
            totalChars: number;
            wpm: number;
            typos: number;
            eta: string;
            preview: string;
          }
        | {
            kind: 'crank';
            jobId: string;
            account: string;
            platform: string;
            workspace: string;
            title: string;
            jobType: string;
            jobStatus: string;
            elapsedMin: number;
            crankPhase: string;
            crankDetail?: string;
            preview: string;
          }
        | {
            kind: 'generating';
            jobId: string;
            account: string;
            platform: string;
            workspace: string;
            title: string;
            jobType: string;
            jobStatus: string;
            elapsedMin: number;
            phaseLabel?: string;
            preview: string;
            chars: number;
            totalChars: number;
            wpm: number;
            typos: number;
            eta: string;
          }
      >;
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
  crankFeed: (params?: { period?: 'today' | 'yesterday' | '7d' | '30d' }) =>
    request<{
      period?: 'today' | 'yesterday' | '7d' | '30d';
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
    }>(`/api/crank/feed${qs({ period: params?.period })}`, {
      sameOrigin: typeof window === 'undefined' ? false : true,
      cache: 'no-store',
    }),
  seoKeywords: (workspace: string, opts?: { force?: boolean }) =>
    cachedFetch(
      `seo:${workspace}`,
      30_000,
      () =>
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
      opts,
    ),
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
  calendarJobs: (params?: { month?: string; workspace?: string }, opts?: { force?: boolean }) =>
    cachedFetch(
      `calendar:${params?.month ?? 'all'}:${params?.workspace ?? 'all'}`,
      15_000,
      () =>
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
      opts,
    ),
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
  adsenseStats: (workspace: string, opts?: { force?: boolean }) =>
    cachedFetch(
      `adsense:${workspace}`,
      60_000,
      () =>
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
      opts,
    ),
  stopAll: (reason: string) =>
    request('/api/stop-all', { method: 'POST', body: JSON.stringify({ reason }) }),
  advanceJob: (id: string) => request(`/api/jobs/${id}/advance`, { method: 'PATCH' }),
  reconcilePublishJob: (id: string) =>
    request<{ ok: boolean; result_url: string; job: HumaJob }>(`/api/jobs/${id}/reconcile-publish`, {
      method: 'POST',
    }),
  revertPublishJob: (id: string) =>
    request<{ ok: boolean; job: HumaJob }>(`/api/jobs/${id}/revert-publish`, {
      method: 'POST',
    }),
  resumeAll: () => request('/api/resume-all', { method: 'POST' }),
  getCaptchaDrillStatus: () =>
    request<{ enabled: boolean; activeJobId: string | null }>('/api/system/captcha-drill', {
      sameOrigin: typeof window !== 'undefined',
    }),
  startCaptchaDrill: (workspace: string) =>
    request<{
      success: boolean;
      jobId: string;
      workspace: string;
      queueUrl: string;
      telegram: {
        ok: boolean;
        error?: string;
        skipped?: string;
        env: { hasToken: boolean; chatId: string | null; webUrl: boolean; vncUrl: boolean };
      };
      browser: { mode: string; display: string };
    }>('/api/system/captcha-drill', {
      method: 'POST',
      body: JSON.stringify({ workspace }),
      sameOrigin: typeof window !== 'undefined',
      timeoutMs: 55_000,
    }),
  testTelegram: (workspace: string) =>
    request<{
      success?: boolean;
      ok: boolean;
      chatId: string | null;
      botUsername?: string;
      error?: string;
      env: { hasToken: boolean; chatId: string | null; webUrl: boolean; vncUrl: boolean };
    }>('/api/system/telegram-test', {
      method: 'POST',
      body: JSON.stringify({ workspace }),
      sameOrigin: typeof window !== 'undefined',
    }),
  getVncStatus: () =>
    request<{
      port: number;
      display: string;
      listening: boolean;
      xvfb: boolean;
      x11vnc: boolean;
      drillActive: boolean;
      vncUrlYeonun: string | null;
      vncEndpoint: string | null;
      tailscale: boolean;
      hint: string;
    }>('/api/system/vnc-status', { sameOrigin: typeof window !== 'undefined' }),
  blogCheckAccounts: () =>
    request<{
      accounts: Array<{
        account_id: string;
        label: string;
        svc: string;
        blog_url: string;
        idx_score: number | null;
        total_posts: number;
        strong_count: number;
        good_count: number;
        weak_count: number;
        collect_count: number;
        miss_count: number;
        miss_rate: number;
        trend: (number | null)[];
        trend_direction: '안정' | '악화' | '개선' | '데이터 부족';
        session_status: '정상' | '오류';
      }>;
      lastScanAt: string | null;
      scanning: boolean;
      scanProgress: {
        accountId: string | null;
        accountLabel: string | null;
        completed: number;
        total: number;
        percent: number;
        phase: 'preparing' | 'scanning' | 'done';
      } | null;
    }>('/api/blog-check/accounts'),
  blogCheckPosts: (accountId: string) =>
    request<{
      posts: Array<{
        post_url: string;
        post_no: string | null;
        title: string;
        published_at: string;
        status: 'strong' | 'good' | 'weak' | 'collect' | 'miss' | null;
        rank: number | null;
        chars: number;
        img_count: number;
        video_count: number;
        quote_count: number;
        comment_count: number;
        like_count: number;
        gif_count: number;
        map_count: number;
        hidden_count: number;
        int_link_count: number;
        ext_link_count: number;
      }>;
    }>(`/api/blog-check/posts/${accountId}`),
  blogCheckPostsByBlog: (blogId: string) =>
    request<{
      blogId: string;
      registered: boolean;
      idxScore: number | null;
      scannedAt: string | null;
      posts: Array<{
        post_url: string;
        post_no: string | null;
        title: string;
        published_at: string;
        status: 'strong' | 'good' | 'weak' | 'collect' | 'miss' | null;
        rank: number | null;
        chars: number;
        img_count: number;
        video_count: number;
        quote_count: number;
        comment_count: number;
        like_count: number;
        gif_count: number;
        map_count: number;
        hidden_count: number;
        int_link_count: number;
        ext_link_count: number;
      }>;
    }>(`/api/blog-check/posts/by-blog/${encodeURIComponent(blogId)}`),
  blogCheckStatus: () =>
    request<{
      scanning: boolean;
      lastScanAt: string | null;
      scanProgress: {
        accountId: string | null;
        accountLabel: string | null;
        completed: number;
        total: number;
        percent: number;
        phase: 'preparing' | 'scanning' | 'done';
      } | null;
    }>('/api/blog-check/status'),
  blogCheckLookup: (query: string) =>
    request<{
      blogId: string;
      registered: boolean;
      accountId: string | null;
      label: string | null;
      svc: string | null;
    }>(`/api/blog-check/lookup?q=${encodeURIComponent(query)}`),
  blogCheckScan: (
    accountId?: string,
    opts?: { mode?: 'full' | 'delta' | 'posts'; postNos?: string[] },
  ) =>
    request<{ queued: true; accountId?: string; blogId?: string; mode?: string }>(
      accountId ? `/api/blog-check/scan/${accountId}` : '/api/blog-check/scan',
      {
        method: 'POST',
        body: JSON.stringify(opts ?? { mode: 'full' }),
      },
    ),
  blogCheckSearchScan: (query: string) =>
    request<{
      queued: true;
      accountId?: string;
      blogId: string;
      mode: string;
      registered: boolean;
      label: string | null;
    }>('/api/blog-check/scan/search', {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),
};
