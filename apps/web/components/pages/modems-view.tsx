'use client';

import { useEffect, useState } from 'react';
import type { HumaModem } from '@huma/shared';
import { api } from '@/lib/api';
import { WORKSPACES } from '@/lib/constants';
import { MPanel, MTable, MTag } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

export function ModemsView() {
  const [modems, setModems] = useState<HumaModem[]>([]);
  const [accounts, setAccounts] = useState<Array<{ name: string; workspace: string }>>([]);

  useEffect(() => {
    Promise.all([api.modems(), api.accounts()]).then(([m, a]) => {
      setModems(m);
      setAccounts(a.map((x) => ({ name: x.name, workspace: x.workspace })));
    }).catch(() => {});
  }, []);

  useRegisterPageAction('openModemForm', () => {
    alert('모뎀은 Supabase huma_modems 테이블에 등록합니다.');
  });

  const rows = modems.length
    ? modems.map((m, i) => {
        const ac = accounts[i];
        const ws = WORKSPACES.find((w) => w.id === ac?.workspace)?.short ?? '—';
        const tone = m.status === 'error' ? 'err' : m.status === 'reconnecting' ? 'warn' : 'ok';
        return [
          ac?.name ?? `Slot ${m.slot_number}`,
          ws,
          <span key="ip" className="font-mono">{m.current_ip ?? '—'}</span>,
          m.carrier ?? '서울',
          <span key="ms" className={`font-mono ${tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'err'}`}>{m.response_ms ?? '—'}ms</span>,
          <MTag key="s" tone={tone}>{m.status === 'idle' ? '정상' : m.status}</MTag>,
        ];
      })
    : accounts.slice(0, 6).map((ac, i) => [
        ac.name,
        WORKSPACES.find((w) => w.id === ac.workspace)?.short ?? '—',
        <span key="ip" className="font-mono">—</span>,
        '—',
        <span key="ms" className="font-mono">—</span>,
        <MTag key="s" tone="idle">미등록</MTag>,
      ]);

  return (
    <div className="animate-fadeIn">
      <MPanel title="Residential Proxy · 계정별 고정 IP">
        <MTable head={['계정', '서비스', 'IP', '지역', '응답', '상태']} rows={rows} />
        {modems.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {modems.map((m) => (
              <button key={m.id} type="button" className="btn-ghost text-[10px]" onClick={() => api.reconnectModem(m.id).then(() => api.modems().then(setModems))}>
                Slot {m.slot_number} IP 재발급
              </button>
            ))}
          </div>
        )}
      </MPanel>
    </div>
  );
}
