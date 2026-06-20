'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountType, HumaAccount, Workspace } from '@huma/shared';
import {
  CRANK_POOL_WORKSPACE,
  CRANK_SERVICE_ORDER,
  crankLabelOf,
  crankServiceLabelKo,
  crankWorkspaceFromLabel,
  isCrankPoolAccount,
  sortAccountsByCrankLabel,
} from '@huma/shared';
import { api } from '@/lib/api';
import { appAlert, appConfirm } from '@/lib/app-dialog';
import { WORKSPACES } from '@/lib/constants';
import { MAccountCard, MGrid, MStat } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { useAuth } from '@/lib/auth-context';
import { alertAccountError } from '@/lib/account-errors';
import { copyVncEndpoint, parseVncEndpoint } from '@/lib/open-vnc';
import { BlogPersonaModal } from '@/components/accounts/blog-persona-modal';
import { VideoPersonaModal } from '@/components/accounts/video-persona-modal';
import {
  BUSINESS_UNITS,
  defaultAccountGroup,
  getAccessibleBusinessUnits,
  isSuperAdmin,
  type BusinessUnit,
} from '@/lib/admin-scope';

const POSTING_COLUMNS: { ws: Workspace; title: string; sub: string }[] = [
  { ws: 'yeonun', title: '연운', sub: '동글1~3 · :10001~03' },
  { ws: 'quizoasis', title: '퀴즈오아시스', sub: '동글5 · :10005' },
  { ws: 'panana', title: '파나나', sub: '동글4 · :10004' },
];

type AccountCategory = 'posting' | 'crank' | 'social';

const CATEGORY_OPTIONS: { value: AccountCategory; label: string; sub: string }[] = [
  { value: 'posting', label: '포스팅', sub: '네이버 블로그 발행 (지수5)' },
  { value: 'crank', label: 'C-Rank+Cafe', sub: '초기 10~최대 150 · 소통·카페·바이럴' },
  { value: 'social', label: '소셜미디어', sub: 'YouTube Shorts·TikTok·IG·Threads·X·Pinterest API' },
];

const SOCIAL_PLATFORMS_BASE = [
  { value: 'youtube', label: 'YouTube Shorts' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'threads', label: 'Threads' },
  { value: 'twitter', label: 'X (Twitter)' },
];

/** 연운·파나나 — 채널 1개씩 */
const SOCIAL_PLATFORMS_STANDARD = [
  ...SOCIAL_PLATFORMS_BASE,
  { value: 'instagram', label: 'Instagram' },
];

const SOCIAL_PLATFORMS_YEONUN = SOCIAL_PLATFORMS_STANDARD;

/** 퀴즈오아시스 — Pinterest 추가 (릴스·핀) */
const SOCIAL_PLATFORMS_QUIZOASIS = [
  ...SOCIAL_PLATFORMS_STANDARD,
  { value: 'pinterest', label: 'Pinterest' },
];

const SOCIAL_PLATFORMS_PANANA = SOCIAL_PLATFORMS_STANDARD;

const ALL_SOCIAL_PLATFORMS = [
  ...SOCIAL_PLATFORMS_QUIZOASIS,
  ...SOCIAL_PLATFORMS_PANANA.filter(
    (p) => !SOCIAL_PLATFORMS_QUIZOASIS.some((q) => q.value === p.value),
  ),
];

function socialPlatformLabel(platform: string): string {
  return ALL_SOCIAL_PLATFORMS.find((p) => p.value === platform)?.label ?? platform;
}

/** 모든 소셜 — 서버 .env(워크스페이스별) 인증. UI는 채널명(@handle)만 등록 */
function isEnvManagedSocialPlatform(_platform: string): boolean {
  return true;
}

function socialEnvHint(platform: string): string {
  const ws = 'YEONUN|QUIZOASIS|PANANA';
  if (platform === 'youtube') return `서버 .env — YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN_{${ws}}`;
  if (platform === 'tiktok') return `서버 .env — TIKTOK_CLIENT_KEY/SECRET/ACCESS_TOKEN_{${ws}}`;
  if (platform === 'threads') return `서버 .env — META_ACCESS_TOKEN + META_THREADS_USER_ID_{${ws}}`;
  if (platform.startsWith('instagram')) return `서버 .env — META_ACCESS_TOKEN + META_IG_USER_ID_{${ws}}`;
  if (platform.startsWith('twitter')) return `서버 .env — TWITTER_API_KEY/SECRET/ACCESS_TOKEN/ACCESS_SECRET_{${ws}}`;
  if (platform === 'pinterest') return '서버 .env — PINTEREST_ACCESS_TOKEN, PINTEREST_BOARD_ID';
  return `서버 .env — 워크스페이스별 API 키`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidAccountId(id: string): boolean {
  return UUID_RE.test(id.trim());
}

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
  const units = getAccessibleBusinessUnits(admin);
  return POSTING_COLUMNS.filter((c) => units.includes(c.ws));
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
  return appConfirm(`「${label}」 계정을 삭제할까요?\n삭제 후에는 복구할 수 없습니다.`, { destructive: true });
}

function emptyForm(registerUnit: BusinessUnit) {
  return {
    registerUnit,
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

export function AccountsView() {
  const { admin, loading: authLoading } = useAuth();
  const { workspace: sidebarWorkspace } = useWorkspace();
  const superAdmin = isSuperAdmin(admin);
  const defaultUnit = defaultAccountGroup(admin);
  const registerUnits = useMemo(() => getAccessibleBusinessUnits(admin), [admin]);

  const [accounts, setAccounts] = useState<HumaAccount[]>([]);
  const [platforms, setPlatforms] = useState<Array<Record<string, unknown>>>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(() => emptyForm(defaultUnit));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingAccount, setEditingAccount] = useState<HumaAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [editBlogUrl, setEditBlogUrl] = useState('');
  const [editNaverId, setEditNaverId] = useState('');
  const [editNaverPw, setEditNaverPw] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<Record<string, unknown> | null>(null);
  const [editPlatformUsername, setEditPlatformUsername] = useState('');
  const [editPlatformUserId, setEditPlatformUserId] = useState('');
  const [editPlatformSaving, setEditPlatformSaving] = useState(false);
  const [personaAccount, setPersonaAccount] = useState<HumaAccount | null>(null);
  const [videoPersonaAccount, setVideoPersonaAccount] = useState<HumaAccount | null>(null);
  const [personaSaving, setPersonaSaving] = useState(false);
  const [personaError, setPersonaError] = useState('');
  const [remoteAccessId, setRemoteAccessId] = useState<string | null>(null);

  const postingColumns = useMemo(() => visiblePostingColumns(admin), [admin]);

  const load = useCallback((opts?: { force?: boolean }) => {
    Promise.all([api.accounts(opts), api.platformAccounts()])
      .then(([a, p]) => {
        setAccounts(a);
        setPlatforms(p);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openAccountForm = () => {
    setShowForm((v) => !v);
    setError('');
    const unit = registerUnits.includes(sidebarWorkspace as BusinessUnit)
      ? (sidebarWorkspace as BusinessUnit)
      : defaultUnit;
    setForm(emptyForm(unit));
  };

  useRegisterPageAction('openAccountForm', openAccountForm);

  const crankPoolAccounts = useMemo(
    () => sortAccountsByCrankLabel(accounts.filter(isCrankPool)),
    [accounts],
  );

  const crankByService = useMemo(() => {
    const crankOnly = crankPoolAccounts.filter((ac) => ac.account_type === 'crank');
    return CRANK_SERVICE_ORDER.map((ws) => ({
      ws,
      title: crankServiceLabelKo(ws),
      accounts: crankOnly.filter(
        (ac) => (ac.crank_workspace ?? crankWorkspaceFromLabel(ac.crank_label) ?? 'yeonun') === ws,
      ),
    }));
  }, [crankPoolAccounts]);

  const cafeAccounts = useMemo(
    () => crankPoolAccounts.filter((ac) => ac.account_type === 'cafe'),
    [crankPoolAccounts],
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
    form.registerUnit === 'quizoasis'
      ? SOCIAL_PLATFORMS_QUIZOASIS
      : form.registerUnit === 'panana'
        ? SOCIAL_PLATFORMS_PANANA
        : SOCIAL_PLATFORMS_YEONUN;

  const registerUnitLabel =
    BUSINESS_UNITS.find((u) => u.id === form.registerUnit)?.label ?? form.registerUnit;

  const handleCreate = async () => {
    setError('');
    setSaving(true);
    try {
      if (isSocial) {
        if (!form.username.trim()) {
          setError('소셜 계정은 채널명 / @handle이 필요합니다.');
          return;
        }
        if (!isEnvManagedSocialPlatform(form.platform) && !form.access_token.trim()) {
          setError('API Access Token을 입력하세요.');
          return;
        }
        await api.createPlatformAccount({
          workspace: form.registerUnit,
          platform: form.platform,
          username: form.username.trim(),
          access_token: isEnvManagedSocialPlatform(form.platform)
            ? 'env-managed'
            : form.access_token.trim(),
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
        await api.createAccount({
          workspace: form.category === 'crank' ? CRANK_POOL_WORKSPACE : form.registerUnit,
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
      load({ force: true });
    } catch (e) {
      alertAccountError(e, { naverId: form.naver_id, platform: form.platform });
    } finally {
      setSaving(false);
    }
  };

  const handleStartEditPosting = (ac: HumaAccount) => {
    setEditingPlatform(null);
    setEditingAccount(ac);
    setEditName(ac.name ?? '');
    setEditBlogUrl(ac.blog_url ?? '');
    setEditNaverId(ac.naver_id ?? '');
    setEditNaverPw('');
    setError('');
  };

  const handleStartEditPlatform = (p: Record<string, unknown>) => {
    setEditingAccount(null);
    setEditingPlatform(p);
    setEditPlatformUsername(String(p.username ?? ''));
    setEditPlatformUserId(String(p.platform_user_id ?? ''));
    setError('');
  };

  const handleCancelEdit = () => {
    setEditingAccount(null);
    setEditName('');
    setEditBlogUrl('');
    setEditNaverId('');
    setEditNaverPw('');
  };

  const handleCancelPlatformEdit = () => {
    setEditingPlatform(null);
    setEditPlatformUsername('');
    setEditPlatformUserId('');
  };

  const handleSaveEdit = async () => {
    if (!editingAccount) return;
    if (!editNaverId.trim()) {
      setError('네이버 ID는 필수입니다.');
      return;
    }
    const isPosting = editingAccount.account_type === 'posting';
    if (isPosting && !editBlogUrl.trim()) {
      setError('포스팅 계정은 블로그 URL이 필수입니다.');
      return;
    }
    setEditSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        naver_id: editNaverId.trim(),
      };
      if (editName.trim()) body.name = editName.trim();
      if (editBlogUrl.trim()) body.blog_url = editBlogUrl.trim();
      if (editNaverPw.trim()) body.naver_pw = editNaverPw;
      await api.updateAccount(editingAccount.id, body);
      handleCancelEdit();
      load({ force: true });
    } catch (e) {
      alertAccountError(e, { naverId: editNaverId.trim() });
      setError(e instanceof Error ? e.message : '수정 실패');
    } finally {
      setEditSaving(false);
    }
  };

  const handleSavePlatformEdit = async () => {
    if (!editingPlatform) return;
    if (!editPlatformUsername.trim()) {
      setError('채널명 / @handle은 필수입니다.');
      return;
    }
    const platform = String(editingPlatform.platform ?? '');
    const needsUserId = platform === 'instagram' || platform === 'threads' || platform.startsWith('instagram_');
    setEditPlatformSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        username: editPlatformUsername.trim(),
      };
      if (needsUserId) {
        body.platform_user_id = editPlatformUserId.trim() || null;
      }
      await api.updatePlatformAccount(String(editingPlatform.id), body);
      handleCancelPlatformEdit();
      load({ force: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '수정 실패');
    } finally {
      setEditPlatformSaving(false);
    }
  };

  const handleOpenPersona = (ac: HumaAccount) => {
    setPersonaError('');
    if (!ac.id || !isValidAccountId(ac.id)) {
      setPersonaError(
        `계정 id가 유효하지 않습니다 (${ac.name}). Supabase huma_accounts에 연운 포스팅 계정(:${ac.proxy_port ?? '?'})이 등록되어 있는지 확인하세요.`,
      );
      setPersonaAccount(ac);
      return;
    }
    setPersonaAccount(ac);
  };

  const handleRemoteAccess = async (ac: HumaAccount) => {
    setRemoteAccessId(ac.id);
    try {
      const res = await api.startPostingRemoteAccess(ac.id);
      const slot = res.slotLabel ?? `:${res.proxyPort}`;
      let vncNote = '';
      if (res.vncUrl) {
        const endpoint = parseVncEndpoint(res.vncUrl);
        if (endpoint) {
          await copyVncEndpoint(endpoint);
          vncNote = `\n\nVNC 주소가 클립보드에 복사되었습니다.\n${endpoint}\n\nRealVNC Direct로 접속해 naver.com에서 수동 설정하세요.`;
        }
      }
      await appAlert(
        `${res.reused ? '원격접속 세션 포커스' : '원격접속 시작'} — ${ac.name} (${slot})\n해당 계정 IP로 naver.com만 열립니다.${vncNote}`,
      );
    } catch (e) {
      alertAccountError(e);
    } finally {
      setRemoteAccessId(null);
    }
  };

  const handleSavePersona = async (text: string) => {
    if (!personaAccount) return;
    if (!personaAccount.id || !isValidAccountId(personaAccount.id)) {
      setPersonaError('저장할 수 없는 계정 id입니다. 계정관리에서 연운3 포스팅 계정을 다시 등록하세요.');
      return;
    }
    setPersonaSaving(true);
    setPersonaError('');
    try {
      const updated = await api.updateAccountBlogPersona(
        personaAccount.id,
        text,
        personaAccount.proxy_port,
        personaAccount.persona ?? null,
      );
      if (!updated || typeof updated !== 'object') {
        throw new Error('서버 응답 없음 — API 연결·배포 상태를 확인하세요');
      }
      setPersonaAccount(null);
      load();
    } catch (e) {
      setPersonaError(e instanceof Error ? e.message : '페르소나 저장 실패');
    } finally {
      setPersonaSaving(false);
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
      if (editingPlatform?.id === p.id) handleCancelPlatformEdit();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  const platformIcon = (platform: string) => {
    if (platform === 'tiktok') return 'T';
    if (platform === 'instagram' || platform.startsWith('instagram_')) return 'I';
    if (platform === 'threads') return '@';
    if (platform === 'twitter' || platform.startsWith('twitter_')) return 'X';
    if (platform === 'pinterest') return 'P';
    if (platform === 'youtube') return 'Y';
    return 'S';
  };

  const accountsInWorkspace = (ws: Workspace) =>
    accounts
      .filter((a) => isPostingAccount(a) && a.workspace === ws)
      .sort((a, b) => (a.proxy_port ?? 99) - (b.proxy_port ?? 99));

  const platformsInWorkspace = (ws: Workspace) =>
    platforms.filter((p) => String(p.workspace) === ws);

  if (authLoading) {
    return <div className="animate-fadeIn py-8 text-center text-[12px] text-huma-t3">계정 목록 불러오는 중…</div>;
  }

  return (
    <div className="accounts-view animate-fadeIn">
      <div className="mb-3 flex items-center justify-end">
        <button type="button" className="btn-primary btn-sm" onClick={openAccountForm}>
          + 계정 추가
        </button>
      </div>

      <MGrid cols={3} className="accounts-stats-row">
        <MStat
          label="포스팅 계정 (지수5)"
          value={<>{posting}<span className="text-[12.5px] text-huma-t3">개</span></>}
          sub="연운·퀴즈·파나나"
        />
        <MStat
          label="C-Rank 소통 계정"
          value={<>{crankCafe}<span className="text-[12.5px] text-huma-t3">개</span></>}
          sub="CRANK 풀 · 최대 150"
        />
        <MStat
          label="소셜미디어 계정"
          value={<>{visiblePlatforms.length}<span className="text-[12.5px] text-huma-t3">개</span></>}
          sub="TikTok·IG·Threads·X·YT쇼츠"
        />
      </MGrid>

      {showForm && (
        <div className="m-panel mb-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-huma-t">계정 유형 선택</div>
            {superAdmin && registerUnits.length > 1 ? (
              <select
                value={form.registerUnit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, registerUnit: e.target.value as BusinessUnit }))
                }
                className="m-model-select w-full max-w-full"
              >
                {registerUnits.map((unit) => (
                  <option key={unit} value={unit}>
                    {BUSINESS_UNITS.find((u) => u.id === unit)?.label ?? unit}
                  </option>
                ))}
              </select>
            ) : (
              <div className="font-mono text-[11px] text-huma-acc">등록: {registerUnitLabel}</div>
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

          <div className="accounts-form-row">
            {isSocial ? (
              <>
                <select
                  value={form.platform}
                  onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
                  className="m-model-select w-full"
                >
                  {socialPlatforms.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <input
                  placeholder="계정명 / @handle"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  className="m-model-select w-full"
                />
                <input
                  type="password"
                  placeholder={socialEnvHint(form.platform)}
                  value={form.access_token}
                  onChange={(e) => setForm((f) => ({ ...f, access_token: e.target.value }))}
                  disabled={isEnvManagedSocialPlatform(form.platform)}
                  className="m-model-select w-full disabled:opacity-50"
                />
              </>
            ) : (
              <>
                <input
                  placeholder="표시 이름"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="m-model-select w-full"
                />
                <input
                  placeholder="네이버 ID"
                  value={form.naver_id}
                  onChange={(e) => setForm((f) => ({ ...f, naver_id: e.target.value }))}
                  className="m-model-select w-full"
                />
                <input
                  type="password"
                  placeholder="비밀번호"
                  value={form.naver_pw}
                  onChange={(e) => setForm((f) => ({ ...f, naver_pw: e.target.value }))}
                  className="m-model-select w-full"
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
                    className="m-model-select w-full"
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
              포스팅 URL 필수 · 연운=동글1~3 · 파나나=동글4(192.168.3.4) · 퀴즈=동글5(192.168.3.5)
            </p>
          )}

          {form.category === 'crank' && (
            <p className="font-mono text-[10.5px] text-huma-t3">
              C-Rank+Cafe는 연운·퀴즈+파나나 공용 풀입니다. 모든 담당자가 동일 계정을 관리합니다.
            </p>
          )}

          {form.registerUnit !== 'yeonun' && isSocial && (
            <p className="font-mono text-[10.5px] text-huma-t3">
              소셜 API는 선택한 사업 단위({registerUnitLabel})에 등록됩니다.
            </p>
          )}

          {error && <p className="text-xs text-huma-err">{error}</p>}
        </div>
      )}

      {personaAccount && (
        <BlogPersonaModal
          account={personaAccount}
          open
          onClose={() => {
            setPersonaAccount(null);
            setPersonaError('');
          }}
          onSave={handleSavePersona}
          saving={personaSaving}
          error={personaError}
        />
      )}

      {videoPersonaAccount && (
        <VideoPersonaModal
          account={videoPersonaAccount}
          open
          onClose={() => setVideoPersonaAccount(null)}
        />
      )}

      {editingAccount && (
        <div className="m-panel mb-3 space-y-2">
          <div className="text-[12px] font-semibold text-huma-t">
            {editingAccount.account_type === 'posting'
              ? '포스팅'
              : editingAccount.account_type === 'cafe'
                ? '카페'
                : 'C-Rank'}{' '}
            계정 수정 · {editingAccount.name || crankLabelOf(editingAccount)}
          </div>
          <div className="accounts-form-row">
            {editingAccount.account_type !== 'posting' && (
              <input
                placeholder="표시 이름"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="m-model-select w-full"
              />
            )}
            <input
              placeholder="네이버 ID"
              value={editNaverId}
              onChange={(e) => setEditNaverId(e.target.value)}
              className="m-model-select w-full"
              autoComplete="username"
            />
            <input
              type="password"
              placeholder="비밀번호 (변경 시에만 입력)"
              value={editNaverPw}
              onChange={(e) => setEditNaverPw(e.target.value)}
              className="m-model-select w-full"
              autoComplete="new-password"
            />
            <input
              placeholder={
                editingAccount.account_type === 'posting'
                  ? 'https://blog.naver.com/...'
                  : '블로그 URL (선택)'
              }
              value={editBlogUrl}
              onChange={(e) => setEditBlogUrl(e.target.value)}
              className="m-model-select w-full sm:col-span-2"
            />
            <button type="button" className="btn-primary" onClick={handleSaveEdit} disabled={editSaving}>
              {editSaving ? '저장 중…' : '저장'}
            </button>
            <button type="button" className="btn-ghost" onClick={handleCancelEdit}>
              취소
            </button>
          </div>
          <p className="font-mono text-[10.5px] text-huma-t3">
            비밀번호를 비우면 기존 비밀번호가 유지됩니다.
          </p>
          {editingAccount.account_type === 'posting' && !editingAccount.blog_url && (
            <p className="font-mono text-[10.5px] text-huma-warn">블로그 URL 미등록 — 발행 job에 필요합니다.</p>
          )}
          {error && editingAccount && <p className="text-xs text-huma-err">{error}</p>}
        </div>
      )}

      {editingPlatform && (
        <div className="m-panel mb-3 space-y-2">
          <div className="text-[12px] font-semibold text-huma-t">
            소셜미디어 계정 수정 · {socialPlatformLabel(String(editingPlatform.platform ?? ''))}
          </div>
          <div className="accounts-form-row">
            <input
              placeholder="채널명 / @handle"
              value={editPlatformUsername}
              onChange={(e) => setEditPlatformUsername(e.target.value)}
              className="m-model-select w-full"
            />
            {(String(editingPlatform.platform ?? '') === 'instagram' ||
              String(editingPlatform.platform ?? '') === 'threads' ||
              String(editingPlatform.platform ?? '').startsWith('instagram_')) && (
              <input
                placeholder="Meta platform_user_id (IG·Threads 숫자 ID, 선택)"
                value={editPlatformUserId}
                onChange={(e) => setEditPlatformUserId(e.target.value)}
                className="m-model-select w-full sm:col-span-2"
              />
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={handleSavePlatformEdit}
              disabled={editPlatformSaving}
            >
              {editPlatformSaving ? '저장 중…' : '저장'}
            </button>
            <button type="button" className="btn-ghost" onClick={handleCancelPlatformEdit}>
              취소
            </button>
          </div>
          <p className="font-mono text-[10.5px] text-huma-t3">
            API 토큰·앱 키는 서버 .env에서 관리합니다. ({socialEnvHint(String(editingPlatform.platform ?? ''))})
          </p>
          {error && editingPlatform && <p className="text-xs text-huma-err">{error}</p>}
        </div>
      )}

      <MGrid cols={3} className="accounts-posting-cols">
        <div>
          {postingColumns.map((col, idx) => {
            const colAccounts = accountsInWorkspace(col.ws);
            return (
              <div key={col.ws}>
                <div className="m-ws-col-title">
                  {idx === 0 ? '포스팅 계정 — 연운' : `포스팅 계정 — ${col.title}`}
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
                          <span className="m-type-badge m-type-posting">POSTING</span>
                        </>
                      }
                      url={
                        ac.blog_url ??
                        `${ac.naver_id} · :${ac.proxy_port ?? '?'} · 지수${ac.blog_index ?? 5}`
                      }
                      status={statusLabel(ac)}
                      statusTone={!ac.blog_url ? 'warn' : statusTone(ac)}
                      stats={[
                        { label: 'Health', value: ac.health_score ?? '—', tone: (ac.health_score ?? 100) >= 80 ? 'text-huma-ok' : 'text-huma-warn' },
                        { label: 'Index', value: ac.blog_index ?? '—' },
                        { label: 'WPM', value: ac.wpm ?? '—' },
                      ]}
                      actions={[
                        { label: '편집', primary: true, onClick: () => handleStartEditPosting(ac) },
                        {
                          label: remoteAccessId === ac.id ? '접속 중…' : '🖥 원격접속',
                          onClick: () => void handleRemoteAccess(ac),
                        },
                        { label: ac.is_active ? '정지' : '재개', onClick: () => api.updateAccount(ac.id, { is_active: !ac.is_active }).then(() => load({ force: true })) },
                      ]}
                      actionsSecondary={[
                        { label: '포스팅 페르소나', onClick: () => handleOpenPersona(ac) },
                        { label: '영상 페르소나', primary: true, onClick: () => setVideoPersonaAccount(ac) },
                      ]}
                    />
                  ))
                ) : (
                  <div className="m-ac text-center text-[11px] text-huma-t3">포스팅 계정 없음</div>
                )}
              </div>
            );
          })}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="m-ws-col-title mb-0">C-Rank 소통 계정 ({crankCafe}개)</div>
            <button type="button" className="btn-ghost btn-sm text-[10px]" onClick={openAccountForm}>
              + 추가
            </button>
          </div>
          {crankByService.map(({ ws, title, accounts: svcAccounts }) => (
            <div key={ws} className="mb-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-huma-t3">
                {title} ({svcAccounts.length})
              </div>
              {svcAccounts.length ? (
                svcAccounts.map((ac) => (
                  <MAccountCard
                    key={ac.id}
                    icon="CR"
                    iconBg="var(--ok-bg)"
                    name={
                      <>
                        {crankLabelOf(ac)}{' '}
                        <span className="m-type-badge m-type-crank">C-RANK</span>
                      </>
                    }
                    url={ac.name || ac.blog_url || '방문·공감·댓글'}
                    status={statusLabel(ac)}
                    statusTone={statusTone(ac)}
                    stats={[
                      { label: 'Health', value: ac.health_score ?? '—', tone: (ac.health_score ?? 100) >= 80 ? 'text-huma-ok' : 'text-huma-warn' },
                      { label: 'Warmup', value: ac.warmup_day ?? 0 },
                      { label: '오늘', value: ac.crank_count_today ?? 0 },
                    ]}
                    actions={[
                      { label: '편집', primary: true, onClick: () => handleStartEditPosting(ac) },
                      { label: ac.is_active ? '정지' : '재개', onClick: () => api.updateAccount(ac.id, { is_active: !ac.is_active }).then(() => load({ force: true })) },
                      { label: '삭제', danger: true, onClick: () => handleDeleteNaver(ac) },
                    ]}
                  />
                ))
              ) : (
                <div className="m-ac mb-1 text-center text-[11px] text-huma-t3">{title} C-Rank 없음</div>
              )}
            </div>
          ))}
          {cafeAccounts.length ? (
            <div className="mb-1">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-huma-t3">
                카페 ({cafeAccounts.length})
              </div>
              {cafeAccounts.map((ac) => (
                <MAccountCard
                  key={ac.id}
                  icon="CF"
                  iconBg="var(--warn-bg)"
                  name={
                    <>
                      {crankLabelOf(ac)}{' '}
                      <span className="m-type-badge m-type-crank">CAFE</span>
                    </>
                  }
                  url={ac.name || '카페 소통'}
                  status={statusLabel(ac)}
                  statusTone={statusTone(ac)}
                  stats={[
                    { label: 'Health', value: ac.health_score ?? '—' },
                    { label: 'Warmup', value: ac.warmup_day ?? 0 },
                    { label: '오늘', value: ac.crank_count_today ?? 0 },
                  ]}
                  actions={[
                    { label: '편집', primary: true, onClick: () => handleStartEditPosting(ac) },
                    { label: ac.is_active ? '정지' : '재개', onClick: () => api.updateAccount(ac.id, { is_active: !ac.is_active }).then(() => load({ force: true })) },
                    { label: '삭제', danger: true, onClick: () => handleDeleteNaver(ac) },
                  ]}
                />
              ))}
            </div>
          ) : null}
          {!crankPoolAccounts.length ? (
            <div className="m-ac text-center text-[11px] text-huma-t3">C-Rank 계정 없음</div>
          ) : null}
        </div>

        <div>
          {postingColumns.map((col, idx) => {
            const colPlatforms = platformsInWorkspace(col.ws);
            if (!colPlatforms.length) return null;
            return (
              <div key={`social-${col.ws}`}>
                <div className="m-ws-col-title">
                  소셜미디어 계정 — {col.title}
                </div>
                {colPlatforms.map((p) => {
                  const platform = String(p.platform ?? '');
                  const active = p.is_active !== false;
                  return (
                    <MAccountCard
                      key={String(p.id)}
                      icon={platformIcon(platform)}
                      iconBg={platform === 'tiktok' ? 'rgba(255,0,80,.1)' : 'var(--blue-bg)'}
                      name={String(p.username ?? platform)}
                      url={`${socialPlatformLabel(platform)} · ${col.title}`}
                      status={active ? '활성' : '세션오류'}
                      statusTone={active ? 'ok' : 'err'}
                      stats={[
                        { label: '팔로워', value: String(p.follower_count ?? '—') },
                        { label: '도달', value: String(p.reach_count ?? '—') },
                        { label: 'API', value: active ? '✓' : '✗', tone: active ? 'text-huma-ok' : 'text-huma-err' },
                      ]}
                      actions={[
                        { label: '편집', primary: true, onClick: () => handleStartEditPlatform(p) },
                        { label: active ? '정지' : '재연결', onClick: () => api.updatePlatformAccount(String(p.id), { is_active: !active }).then(() => load({ force: true })) },
                        { label: '삭제', danger: true, onClick: () => handleDeletePlatform(p) },
                      ]}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </MGrid>
    </div>
  );
}
