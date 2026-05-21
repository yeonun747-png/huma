'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HumaAccount } from '@huma/shared';
import { api } from '@/lib/api';
import { WORKSPACES } from '@/lib/constants';
import { MAccountCard, MGrid, MStat, MTypeBadge } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

const WS_ORDER = ['yeonun', 'quizoasis', 'panana'] as const;

function statusTone(ac: HumaAccount): 'ok' | 'warn' | 'err' | 'live' | 'idle' {
  if (!ac.is_active) return 'warn';
  if ((ac.health_score ?? 100) < 75) return 'warn';
  return 'ok';
}

function statusLabel(ac: HumaAccount) {
  if (!ac.is_active) return 'COOL';
  return 'IDLE';
}

export function AccountsView() {
  const [accounts, setAccounts] = useState<HumaAccount[]>([]);
  const [platforms, setPlatforms] = useState<Array<Record<string, unknown>>>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ workspace: 'yeonun', name: '', naver_id: '', naver_pw: '', account_type: 'posting' });

  const load = useCallback(() => {
    Promise.all([api.accounts(), api.platformAccounts()]).then(([a, p]) => {
      setAccounts(a);
      setPlatforms(p);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useRegisterPageAction('openAccountForm', () => setShowForm((v) => !v));

  const grouped = useMemo(() => {
    const map: Record<string, HumaAccount[]> = { yeonun: [], quizoasis: [], panana: [] };
    accounts.forEach((a) => { if (map[a.workspace]) map[a.workspace].push(a); });
    return map;
  }, [accounts]);

  const posting = accounts.filter((a) => a.account_type === 'posting').length;
  const crank = accounts.filter((a) => a.account_type === 'crank').length;

  const handleCreate = async () => {
    if (!form.name || !form.naver_id) return;
    await api.createAccount({ ...form, is_active: true, health_score: 100, blog_index: 5, wpm: 55 });
    setShowForm(false);
    load();
  };

  return (
    <div className="animate-fadeIn">
      <MGrid cols={3}>
        <MStat label="포스팅 전용 (지수5)" value={<>{posting}<span className="text-[11px] text-huma-t3">개</span></>} sub="블로그 발행 계정" />
        <MStat label="C-Rank 소통 (일반)" value={<>{crank}<span className="text-[11px] text-huma-t3">개</span></>} sub="방문·공감·댓글 전용" />
        <MStat label="소셜미디어 (API)" value={<>{platforms.length}<span className="text-[11px] text-huma-t3">개</span></>} sub="TikTok·IG·Threads·X" />
      </MGrid>

      {showForm && (
        <div className="m-panel mb-3 flex flex-wrap items-end gap-2">
          <select value={form.workspace} onChange={(e) => setForm((f) => ({ ...f, workspace: e.target.value }))} className="m-model-select max-w-[140px]">
            {WORKSPACES.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
          <input placeholder="표시 이름" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="m-model-select max-w-[140px]" />
          <input placeholder="네이버 ID" value={form.naver_id} onChange={(e) => setForm((f) => ({ ...f, naver_id: e.target.value }))} className="m-model-select max-w-[140px]" />
          <input type="password" placeholder="비밀번호" value={form.naver_pw} onChange={(e) => setForm((f) => ({ ...f, naver_pw: e.target.value }))} className="m-model-select max-w-[140px]" />
          <button type="button" className="btn-primary" onClick={handleCreate}>추가</button>
        </div>
      )}

      <MGrid cols={3}>
        {WS_ORDER.map((ws) => (
          <div key={ws}>
            <div className="m-ws-col-title">{WORKSPACES.find((w) => w.id === ws)?.short ?? ws}</div>
            {grouped[ws]?.length ? grouped[ws].map((ac) => (
              <MAccountCard
                key={ac.id}
                icon="📝"
                iconBg="var(--ok-bg)"
                name={<>{ac.name} {ac.account_type === 'posting' && <MTypeBadge type={ws === 'quizoasis' ? 'shared' : 'posting'} />}</>}
                url={`${ac.naver_id ?? ac.name} · 지수${ac.blog_index ?? 5}`}
                status={statusLabel(ac)}
                statusTone={statusTone(ac)}
                stats={[
                  { label: 'Health', value: ac.health_score ?? '—', tone: (ac.health_score ?? 100) >= 80 ? 'text-huma-ok' : 'text-huma-warn' },
                  { label: 'Index', value: ac.blog_index ?? '—' },
                  { label: 'WPM', value: ac.wpm ?? '—' },
                ]}
                actions={[
                  { label: '편집', primary: true, onClick: () => api.updateAccount(ac.id, { is_active: ac.is_active }) },
                  { label: '로그', onClick: () => api.accountLogs(ac.id).then((logs) => console.log(logs)) },
                  { label: ac.is_active ? '정지' : '재개', onClick: () => api.updateAccount(ac.id, { is_active: !ac.is_active }).then(load) },
                ]}
              />
            )) : (
              <div className="m-ac text-center text-[11px] text-huma-t3">등록된 계정 없음</div>
            )}
            {ws === 'quizoasis' && platforms.filter((p) => p.workspace === ws).map((p) => (
              <MAccountCard
                key={String(p.id)}
                icon="I"
                iconBg="var(--blue-bg)"
                name={String(p.account_name ?? p.platform)}
                url={`${String(p.platform)} · API`}
                status="활성"
                statusTone="ok"
                stats={[
                  { label: '팔로워', value: '—' },
                  { label: '도달', value: '—' },
                  { label: 'API', value: '✓', tone: 'text-huma-ok' },
                ]}
                actions={[{ label: 'API설정', primary: true }, { label: '로그' }]}
              />
            ))}
            {ws === 'panana' && platforms.filter((p) => p.workspace === ws).map((p) => (
              <MAccountCard
                key={String(p.id)}
                icon="T"
                iconBg="#1a0020"
                name={String(p.account_name ?? '@account')}
                url={`${String(p.platform)} · API`}
                status={p.is_active === false ? '세션오류' : '활성'}
                statusTone={p.is_active === false ? 'err' : 'ok'}
                stats={[
                  { label: '팔로워', value: '—' },
                  { label: '도달', value: p.is_active === false ? '—' : '—', tone: p.is_active === false ? 'err' : undefined },
                  { label: '조치', value: p.is_active === false ? '재로그인↑' : '—', tone: p.is_active === false ? 'text-huma-err' : undefined },
                ]}
                actions={[
                  ...(p.is_active === false ? [{ label: '재연결', danger: true }] : [{ label: '편집', primary: true }]),
                  { label: '로그' },
                ]}
              />
            ))}
          </div>
        ))}
      </MGrid>
    </div>
  );
}
