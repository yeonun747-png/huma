'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountType, HumaAccount, Workspace } from '@huma/shared';
import { CRANK_POOL_WORKSPACE, isCrankPoolAccount } from '@huma/shared';
import { api } from '@/lib/api';
import { WORKSPACES } from '@/lib/constants';
import { MAccountCard, MGrid, MStat } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { useAuth } from '@/lib/auth-context';
import { alertAccountError } from '@/lib/account-errors';
import {
  defaultAccountGroup,
  getAccessibleSubWorkspaces,
  getAccountGroups,
  isSuperAdmin,
  type AccountGroup,
} from '@/lib/admin-scope';

const QP_WORKSPACES: Workspace[] = ['quizoasis', 'panana'];

const POSTING_COLUMNS: { ws: Workspace; title: string; proxyPort: number; sub: string }[] = [
  { ws: 'yeonun', title: '연운', proxyPort: 10001, sub: '동글 10001~10002' },
  { ws: 'quizoasis', title: '퀴즈오아시스', proxyPort: 10003, sub: '동글 10003 · 계정 1개' },
  { ws: 'panana', title: '파나나', proxyPort: 10004, sub: '동글 10004 · 계정 1개' },
];

type AccountCategory = 'posting' | 'crank' | 'social';

const CATEGORY_OPTIONS: { value: AccountCategory; label: string; sub: string }[] = [
  { value: 'posting', label: '포스팅', sub: '네이버 블로그 발행 (지수5)' },
  { value: 'crank', label: 'C-Rank+Cafe', sub: '초기 10~최대 150 · 소통·카페·바이럴' },
  { value: 'social', label: '소셜미디어', sub: 'TikTok·IG·Threads·X·Pinterest API' },
];

const SOCIAL_PLATFORMS_BASE = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'threads', label: 'Threads' },
  { value: 'twitter', label: 'X (Twitter)' },
];

const SOCIAL_PLATFORMS_QUIZOASIS = [
  ...SOCIAL_PLATFORMS_BASE,
  { value: 'instagram_en', label: 'Instagram (EN)' },
  { value: 'instagram_kr', label: 'Instagram (KR)' },
  { value: 'twitter_en', label: 'X (EN)' },
  { value: 'twitter_ja', label: 'X (JA)' },
  { value: 'pinterest', label: 'Pinterest' },
];

const TYPE_LABEL: Record<AccountType, string> = {
  posting: 'POSTING',
  crank: 'C-RANK+CAFE',
  cafe: 'C-RANK+CAFE',
};

function isCrankPool(ac: HumaAccount) {
  return isCrankPoolAccount(ac);
}

function isPostingAccount(ac: HumaAccount) {
  return ac.account_type === 'posting';
}

function visiblePostingColumns(admin: ReturnType<typeof useAuth>['admin']) {
  const groups = getAccountGroups(admin);
  const cols: typeof POSTING_COLUMNS = [];
  if (groups.includes('yeonun')) {
    cols.push(POSTING_COLUMNS.find((c) => c.ws === 'yeonun')!);
  }
  if (groups.includes('quizoasis_panana')) {
    const allowed = getAccessibleSubWorkspaces(admin, 'quizoasis_panana');
    for (const ws of QP_WORKSPACES) {
      if (allowed.includes(ws)) {
        cols.push(POSTING_COLUMNS.find((c) => c.ws === ws)!);
      }
    }
  }
  return cols;
}

function statusTone(ac: HumaAccount): 'ok' | 'warn' | 'err' | 'live' | 'idle' {
  if (!ac.is_active) return 'warn';
  if ((ac.health_score ?? 100) < 75) return 'warn';
  return 'ok';
}

function statusLabel(ac: HumaAccount) {
  if (!ac.is_active) return 'COOL';
  return 'IDLE';
}

async function confirmDelete(label: string) {
  return window.confirm(`「${label}」 계정을 삭제할까요?\n삭제 후에는 복구할 수 없습니다.`);
}

function emptyForm(opts: {
  registerGroup: AccountGroup;
  socialWorkspace: Workspace;
  postingWorkspace?: Workspace;
}) {
  return {
    registerGroup: opts.registerGroup,
    socialWorkspace: opts.socialWorkspace,
    postingWorkspace: opts.postingWorkspace ?? 'quizoasis',
    category: 'posting' as AccountCategory,
    name: '',
    naver_id: '',
    naver_pw: '',
    blog_url: '',
    platform: 'tiktok',
    username: '',
    access_token: '',
  };
}

function resolvePostingWorkspace(group: AccountGroup, postingWorkspace: Workspace): Workspace {
  if (group === 'yeonun') return 'yeonun';
  return postingWorkspace;
}

function resolveSocialWorkspace(group: AccountGroup, form: ReturnType<typeof emptyForm>): Workspace {
  if (group === 'yeonun') return 'yeonun';
  return form.socialWorkspace;
}

export function AccountsView() {
  const { admin, loading: authLoading } = useAuth();
  const { workspace: sidebarWorkspace } = useWorkspace();
  const superAdmin = isSuperAdmin(admin);
  const adminWorkspaces = admin?.workspaces ?? [];

  const defaultGroup = defaultAccountGroup(admin);
  const defaultSocialWs: Workspace = adminWorkspaces.includes('quizoasis')
    ? 'quizoasis'
    : adminWorkspaces.includes('panana')
      ? 'panana'
      : sidebarWorkspace;

  const [accounts, setAccounts] = useState<HumaAccount[]>([]);
  const [platforms, setPlatforms] = useState<Array<Record<string, unknown>>>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(() =>
    emptyForm({
      registerGroup: defaultGroup,
      socialWorkspace: defaultSocialWs,
      postingWorkspace: defaultSocialWs,
    }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingAccount, setEditingAccount] = useState<HumaAccount | null>(null);
  const [editBlogUrl, setEditBlogUrl] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const postingColumns = useMemo(() => visiblePostingColumns(admin), [admin]);
  const listGridCols = (Math.min(3, postingColumns.length) || 1) as 1 | 2 | 3;

  const load = useCallback(() => {
    Promise.all([api.accounts(), api.platformAccounts()])
      .then(([a, p]) => {
        setAccounts(a);
        setPlatforms(p);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRegisterPageAction('openAccountForm', () => {
    setShowForm((v) => !v);
    setError('');
    setForm(
      emptyForm({
        registerGroup: defaultGroup,
        socialWorkspace: QP_WORKSPACES.includes(sidebarWorkspace) ? sidebarWorkspace : defaultSocialWs,
        postingWorkspace: QP_WORKSPACES.includes(sidebarWorkspace) ? sidebarWorkspace : defaultSocialWs,
      }),
    );
  });

  const crankPoolAccounts = useMemo(
    () => accounts.filter(isCrankPool).sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  );

  const visiblePlatforms = useMemo(
    () =>
      platforms.filter((p) =>
        postingColumns.some((c) => c.ws === String(p.workspace)),
      ),
    [platforms, postingColumns],
  );

  const posting = useMemo(
    () =>
      accounts.filter(
        (a) => isPostingAccount(a) && postingColumns.some((c) => c.ws === a.workspace),
      ).length,
    [accounts, postingColumns],
  );
  const crankCafe = crankPoolAccounts.length;
  const isSocial = form.category === 'social';
  const socialPlatforms =
    form.registerGroup === 'quizoasis_panana' ? SOCIAL_PLATFORMS_QUIZOASIS : SOCIAL_PLATFORMS_BASE;

  const registerGroupLabel =
    form.registerGroup === 'yeonun'
      ? '연운'
      : `${POSTING_COLUMNS.find((c) => c.ws === form.postingWorkspace)?.title ?? '퀴즈+파나나'}`;

  const handleCreate = async () => {
    setError('');
    setSaving(true);
    try {
      if (isSocial) {
        if (!form.username.trim() || !form.access_token.trim()) {
          setError('소셜 계정은 사용자명과 API 토큰이 필요합니다.');
          return;
        }
        const targetWs = resolveSocialWorkspace(form.registerGroup, form);
        await api.createPlatformAccount({
          workspace: targetWs,
          platform: form.platform,
          username: form.username.trim(),
          access_token: form.access_token.trim(),
          is_active: true,
        });
      } else {
        if (!form.name.trim() || !form.naver_id.trim()) {
          setError('표시 이름과 네이버 ID는 필수입니다.');
          return;
        }
        if (form.category === 'posting' && !form.blog_url.trim()) {
          setError('포스팅 계정은 블로그 URL이 필수입니다.');
          return;
        }
        const targetWs =
          form.category === 'crank'
            ? CRANK_POOL_WORKSPACE
            : resolvePostingWorkspace(form.registerGroup, form.postingWorkspace);
        await api.createAccount({
          workspace: targetWs,
          name: form.name.trim(),
          naver_id: form.naver_id.trim(),
          naver_pw: form.naver_pw,
          account_type: form.category,
          blog_url: form.blog_url.trim() || undefined,
          is_active: true,
          health_score: 100,
          blog_index: form.category === 'posting' ? 5 : 0,
          wpm: 55,
        });
      }
      setShowForm(false);
      load();
    } catch (e) {
      alertAccountError(e, { naverId: form.naver_id, platform: form.platform });
    } finally {
      setSaving(false);
    }
  };

  const handleStartEditPosting = (ac: HumaAccount) => {
    setEditingAccount(ac);
    setEditBlogUrl(ac.blog_url ?? '');
    setError('');
  };

  const handleCancelEdit = () => {
    setEditingAccount(null);
    setEditBlogUrl('');
  };

  const handleSaveEdit = async () => {
    if (!editingAccount) return;
    if (!editBlogUrl.trim()) {
      setError('포스팅 계정은 블로그 URL이 필수입니다.');
      return;
    }
    setEditSaving(true);
    setError('');
    try {
      await api.updateAccount(editingAccount.id, { blog_url: editBlogUrl.trim() });
      handleCancelEdit();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '수정 실패');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteNaver = async (ac: HumaAccount) => {
    if (!(await confirmDelete(ac.name))) return;
    try {
      await api.deleteAccount(ac.id);
      if (editingAccount?.id === ac.id) handleCancelEdit();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  const handleDeletePlatform = async (p: Record<string, unknown>) => {
    const label = String(p.username ?? p.platform ?? '소셜');
    if (!(await confirmDelete(label))) return;
    try {
      await api.deletePlatformAccount(String(p.id));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  const platformIcon = (platform: string) => {
    if (platform === 'tiktok') return 'T';
    if (platform === 'instagram') return 'I';
    if (platform === 'threads') return '@';
    if (platform === 'twitter') return 'X';
    return 'S';
  };

  const accountsInWorkspace = (ws: Workspace) =>
    accounts.filter((a) => isPostingAccount(a) && a.workspace === ws);

  const platformsInWorkspace = (ws: Workspace) =>
    platforms.filter((p) => String(p.workspace) === ws);

  if (authLoading) {
    return <div className="animate-fadeIn py-8 text-center text-[12px] text-huma-t3">계정 목록 불러오는 중…</div>;
  }

  return (
    <div className="animate-fadeIn">
      <MGrid cols={3}>
        <MStat label="포스팅 (지수5)" value={<>{posting}<span className="text-[11px] text-huma-t3">개</span></>} sub="블로그 발행" />
        <MStat label="C-Rank+Cafe" value={<>{crankCafe}<span className="text-[11px] text-huma-t3">개</span></>} sub="10~150 · 소통·카페" />
        <MStat label="소셜미디어 (API)" value={<>{visiblePlatforms.length}<span className="text-[11px] text-huma-t3">개</span></>} sub="TikTok·IG·Pinterest 등" />
      </MGrid>

      {showForm && (
        <div className="m-panel mb-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-huma-t">계정 유형 선택</div>
            {superAdmin ? (
              <select
                value={form.registerGroup}
                onChange={(e) =>
                  setForm((f) => ({ ...f, registerGroup: e.target.value as AccountGroup }))
                }
                className="m-model-select max-w-[180px]"
              >
                <option value="yeonun">연운</option>
                <option value="quizoasis_panana">퀴즈+파나나</option>
              </select>
            ) : (
              <div className="font-mono text-[11px] text-huma-acc">등록 그룹: {registerGroupLabel}</div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, category: opt.value }))}
                className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                  form.category === opt.value
                    ? 'border-huma-acc bg-huma-glow text-huma-acc'
                    : 'border-huma-bdr text-huma-t3 hover:border-huma-acc/50'
                }`}
              >
                <div className="font-semibold text-huma-t">{opt.label}</div>
                <div className="mt-0.5 text-[10px] leading-snug">{opt.sub}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            {form.registerGroup === 'quizoasis_panana' && (
              <select
                value={isSocial ? form.socialWorkspace : form.postingWorkspace}
                onChange={(e) => {
                  const ws = e.target.value as Workspace;
                  setForm((f) =>
                    isSocial
                      ? { ...f, socialWorkspace: ws }
                      : { ...f, postingWorkspace: ws, socialWorkspace: ws },
                  );
                }}
                className="m-model-select max-w-[140px]"
                title={isSocial ? '소셜 API 서비스' : '포스팅 전용 동글'}
              >
                <option value="quizoasis">퀴즈오아시스</option>
                <option value="panana">파나나</option>
              </select>
            )}

            {isSocial ? (
              <>
                <select
                  value={form.platform}
                  onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
                  className="m-model-select max-w-[140px]"
                >
                  {socialPlatforms.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <input
                  placeholder="계정명 / @handle"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  className="m-model-select max-w-[160px]"
                />
                <input
                  type="password"
                  placeholder="API Access Token"
                  value={form.access_token}
                  onChange={(e) => setForm((f) => ({ ...f, access_token: e.target.value }))}
                  className="m-model-select min-w-[180px] flex-1"
                />
              </>
            ) : (
              <>
                <input
                  placeholder="표시 이름"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="m-model-select max-w-[140px]"
                />
                <input
                  placeholder="네이버 ID"
                  value={form.naver_id}
                  onChange={(e) => setForm((f) => ({ ...f, naver_id: e.target.value }))}
                  className="m-model-select max-w-[140px]"
                />
                <input
                  type="password"
                  placeholder="비밀번호"
                  value={form.naver_pw}
                  onChange={(e) => setForm((f) => ({ ...f, naver_pw: e.target.value }))}
                  className="m-model-select max-w-[140px]"
                />
                {(form.category === 'posting' || form.category === 'crank') && (
                  <input
                    placeholder={
                      form.category === 'posting'
                        ? '블로그 URL (필수) https://blog.naver.com/...'
                        : '블로그 URL (선택)'
                    }
                    value={form.blog_url}
                    onChange={(e) => setForm((f) => ({ ...f, blog_url: e.target.value }))}
                    className="m-model-select min-w-[200px] flex-1"
                    required={form.category === 'posting'}
                  />
                )}
              </>
            )}

            <button type="button" className="btn-primary" onClick={handleCreate} disabled={saving}>
              {saving ? '등록 중…' : '추가'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setShowForm(false); setError(''); }}>
              취소
            </button>
          </div>

          {form.category === 'posting' && (
            <p className="font-mono text-[10.5px] text-huma-t3">
              포스팅은 블로그 URL 필수 · 퀴즈오아시스=동글 :10003(계정 1개) · 파나나=동글 :10004(계정 1개) · 연운=10001~10002
            </p>
          )}

          {form.category === 'crank' && (
            <p className="font-mono text-[10.5px] text-huma-t3">
              C-Rank+Cafe는 연운·퀴즈+파나나 공용 풀입니다. 모든 담당자가 동일 계정을 관리합니다.
            </p>
          )}

          {!superAdmin && form.registerGroup === 'quizoasis_panana' && isSocial && (
            <p className="font-mono text-[10.5px] text-huma-t3">
              퀴즈·파나나는 네이버·C-Rank 계정을 공유합니다. 소셜 API만 서비스별로 등록하세요.
            </p>
          )}

          {error && <p className="text-xs text-huma-err">{error}</p>}
        </div>
      )}

      {editingAccount && (
        <div className="m-panel mb-3 space-y-2">
          <div className="text-[12px] font-semibold text-huma-t">
            블로그 URL 수정 · {editingAccount.name}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input
              placeholder="https://blog.naver.com/..."
              value={editBlogUrl}
              onChange={(e) => setEditBlogUrl(e.target.value)}
              className="m-model-select min-w-[280px] flex-1"
            />
            <button type="button" className="btn-primary" onClick={handleSaveEdit} disabled={editSaving}>
              {editSaving ? '저장 중…' : '저장'}
            </button>
            <button type="button" className="btn-ghost" onClick={handleCancelEdit}>
              취소
            </button>
          </div>
          {!editingAccount.blog_url && (
            <p className="font-mono text-[10.5px] text-huma-warn">블로그 URL 미등록 — 발행 job에 필요합니다.</p>
          )}
          {error && editingAccount && <p className="text-xs text-huma-err">{error}</p>}
        </div>
      )}

      <div className="mb-3">
        <div className="m-ws-col-title">C-Rank+Cafe · 공용 풀</div>
        {crankPoolAccounts.length ? (
          crankPoolAccounts.map((ac) => (
            <MAccountCard
              key={ac.id}
              icon="🔗"
              iconBg="var(--warn-bg)"
              name={
                <>
                  {ac.name}{' '}
                  <span className="ml-1 rounded bg-huma-bg2 px-1.5 py-px font-mono text-[9px] uppercase text-huma-acc">
                    {TYPE_LABEL[ac.account_type]}
                  </span>
                  <span className="ml-1 font-mono text-[9px] text-huma-t3">공용</span>
                </>
              }
              url={ac.blog_url ?? `${ac.naver_id} · 워밍업 ${ac.warmup_day ?? 0}일`}
              status={statusLabel(ac)}
              statusTone={statusTone(ac)}
              stats={[
                { label: 'Health', value: ac.health_score ?? '—', tone: (ac.health_score ?? 100) >= 80 ? 'text-huma-ok' : 'text-huma-warn' },
                { label: 'Warmup', value: ac.warmup_day ?? 0 },
                { label: '오늘 소통', value: ac.crank_count_today ?? 0 },
              ]}
              actions={[
                { label: ac.is_active ? '정지' : '재개', primary: true, onClick: () => api.updateAccount(ac.id, { is_active: !ac.is_active }).then(load) },
                { label: '로그', onClick: () => api.accountLogs(ac.id).then((logs) => console.log(logs)) },
                { label: '삭제', danger: true, onClick: () => handleDeleteNaver(ac) },
              ]}
            />
          ))
        ) : (
          <div className="m-ac text-center text-[11px] text-huma-t3">공용 C-Rank+Cafe 계정 없음</div>
        )}
      </div>

      <MGrid cols={listGridCols}>
        {postingColumns.map((col) => {
          const colAccounts = accountsInWorkspace(col.ws);
          const colPlatforms = platformsInWorkspace(col.ws);

          return (
            <div key={col.ws}>
              <div className="m-ws-col-title">
                {col.title}
                <span className="ml-2 font-mono text-[10px] font-normal text-huma-t3">{col.sub}</span>
              </div>

              {colAccounts.length ? (
                colAccounts.map((ac) => (
                  <MAccountCard
                    key={ac.id}
                    icon="📝"
                    iconBg="var(--ok-bg)"
                    name={
                      <>
                        {ac.name}{' '}
                        <span className="ml-1 rounded bg-huma-bg2 px-1.5 py-px font-mono text-[9px] uppercase text-huma-acc">
                          {TYPE_LABEL[ac.account_type]}
                        </span>
                        {ac.proxy_port && (
                          <span className="ml-1 font-mono text-[9px] text-huma-t3">:{ac.proxy_port}</span>
                        )}
                      </>
                    }
                    url={
                      ac.blog_url ??
                      `${ac.naver_id} · 지수${ac.blog_index ?? 5}${!ac.blog_url ? ' · URL 미등록' : ''}`
                    }
                    status={statusLabel(ac)}
                    statusTone={!ac.blog_url ? 'warn' : statusTone(ac)}
                    stats={[
                      { label: 'Health', value: ac.health_score ?? '—', tone: (ac.health_score ?? 100) >= 80 ? 'text-huma-ok' : 'text-huma-warn' },
                      { label: 'Index', value: ac.blog_index ?? '—' },
                      { label: 'WPM', value: ac.wpm ?? '—' },
                    ]}
                    actions={[
                      { label: '수정', onClick: () => handleStartEditPosting(ac) },
                      { label: ac.is_active ? '정지' : '재개', primary: true, onClick: () => api.updateAccount(ac.id, { is_active: !ac.is_active }).then(load) },
                      { label: '로그', onClick: () => api.accountLogs(ac.id).then((logs) => console.log(logs)) },
                      { label: '삭제', danger: true, onClick: () => handleDeleteNaver(ac) },
                    ]}
                  />
                ))
              ) : (
                <div className="m-ac text-center text-[11px] text-huma-t3">포스팅 계정 없음</div>
              )}

              {colPlatforms.map((p) => {
                const platform = String(p.platform ?? '');
                const active = p.is_active !== false;
                return (
                  <MAccountCard
                    key={String(p.id)}
                    icon={platformIcon(platform)}
                    iconBg={platform === 'tiktok' ? '#1a0020' : 'var(--blue-bg)'}
                    name={
                      <>
                        {String(p.username ?? platform)}
                        <span className="ml-1 rounded bg-huma-bg2 px-1.5 py-px font-mono text-[9px] uppercase text-huma-acc">SOCIAL</span>
                      </>
                    }
                    url={`${socialPlatforms.find((sp) => sp.value === platform)?.label ?? platform} · API`}
                    status={active ? '활성' : '세션오류'}
                    statusTone={active ? 'ok' : 'err'}
                    stats={[
                      { label: '플랫폼', value: platform },
                      { label: '오늘 발행', value: String(p.post_count_today ?? 0) },
                      { label: 'API', value: active ? '✓' : '✗', tone: active ? 'text-huma-ok' : 'text-huma-err' },
                    ]}
                    actions={[
                      { label: active ? '정지' : '재개', primary: true, onClick: () => api.updatePlatformAccount(String(p.id), { is_active: !active }).then(load) },
                      { label: '삭제', danger: true, onClick: () => handleDeletePlatform(p) },
                    ]}
                  />
                );
              })}
            </div>
          );
        })}
      </MGrid>
    </div>
  );
}
