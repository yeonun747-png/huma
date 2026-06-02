'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HumaAccount, HumaModem } from '@huma/shared';
import {
  CRANK_DONGLE_SLOTS,
  POSTING_DONGLE_SLOTS,
  dongleManagementIp,
  postingSlotByPort,
} from '@huma/shared';
import { api } from '@/lib/api';
import { WORKSPACES } from '@/lib/constants';
import { MPanel, MTable, MTag } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

const I7_PHYSICAL_SLOTS = 7;

const SLOT_SERVICE_LABEL: Record<number, string> = {
  1: '연운',
  2: '연운',
  3: '연운',
  4: '파나나',
  5: '퀴즈',
  6: 'C-Rank',
  7: 'C-Rank',
};

type SlotRowDef = {
  slot: number;
  proxyPort: number;
  label: string;
  workspace?: string;
};

const PHYSICAL_DONGLE_SLOTS: SlotRowDef[] = [
  ...POSTING_DONGLE_SLOTS.map((s) => ({
    slot: s.slot,
    proxyPort: s.proxyPort,
    label: s.label,
    workspace: s.workspace,
  })),
  ...CRANK_DONGLE_SLOTS.map((s) => ({
    slot: s.slot,
    proxyPort: s.proxyPort,
    label: s.label,
  })),
];

function accountForModem(modem: HumaModem, accounts: HumaAccount[]): HumaAccount | undefined {
  return accounts.find(
    (a) => a.account_type === 'posting' && a.proxy_port === modem.proxy_port,
  );
}

function resolveModemForSlot(modems: HumaModem[], def: SlotRowDef): HumaModem {
  const m =
    modems.find((x) => x.slot_number === def.slot) ??
    modems.find((x) => x.proxy_port === def.proxyPort);
  return (
    m ?? {
      id: `slot-${def.slot}`,
      slot_number: def.slot,
      proxy_port: def.proxyPort,
      current_ip: dongleManagementIp(def.slot),
      carrier: 'KT',
      status: 'idle' as const,
      created_at: '',
    }
  );
}

export function ModemsView() {
  const [modems, setModems] = useState<HumaModem[]>([]);
  const [accounts, setAccounts] = useState<HumaAccount[]>([]);

  const load = () => {
    Promise.all([api.modems({ probe: true }), api.accounts()])
      .then(([m, a]) => {
        setModems(m);
        setAccounts(a);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  useRegisterPageAction('openModemForm', () => {
    alert(
      '물리 동글 1~7은 Supabase huma_modems(v3_25) + i7 setup-dongle-slots.sh 로 설정합니다.',
    );
  });

  const rows = useMemo(() => {
    return PHYSICAL_DONGLE_SLOTS.map((def) => {
      const m = resolveModemForSlot(modems, def);
      const slot = def.slot;
      const ac = accountForModem(m, accounts);
      const mgmtIp = dongleManagementIp(slot);
      const displayIp = m.current_ip?.startsWith('192.168.3.')
        ? m.current_ip
        : mgmtIp;
      const ws =
        def.workspace ??
        postingSlotByPort(m.proxy_port)?.workspace ??
        ac?.workspace;
      const service =
        SLOT_SERVICE_LABEL[slot] ??
        WORKSPACES.find((w) => w.id === ws)?.short ??
        '—';
      const tone =
        m.status === 'error' ? 'err' : m.status === 'reconnecting' ? 'warn' : 'ok';

      return [
        def.label ?? ac?.name ?? `동글 ${slot}`,
        service,
        <span key="ip" className="font-mono" title={`물리 동글 ${slot} · SOCKS :${m.proxy_port}`}>
          {displayIp}
        </span>,
        m.carrier ?? 'KT',
        <span key="ms" className={`font-mono ${tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'err'}`}>
          {m.response_ms ?? '—'}ms
        </span>,
        <MTag key="s" tone={tone}>
          {m.status === 'idle' ? '정상' : m.status}
        </MTag>,
      ];
    });
  }, [modems, accounts]);

  const extraRows = useMemo(() => {
    return modems
      .filter((m) => m.slot_number > I7_PHYSICAL_SLOTS && m.slot_number <= 10)
      .sort((a, b) => a.slot_number - b.slot_number)
      .map((m) => {
        const tone =
          m.status === 'error' ? 'err' : m.status === 'reconnecting' ? 'warn' : 'ok';
        return [
          `슬롯 ${m.slot_number}`,
          m.modem_role ?? '—',
          <span key="ip" className="font-mono" title={`SOCKS :${m.proxy_port}`}>
            {m.current_ip ?? '—'}
          </span>,
          m.carrier ?? '—',
          <span key="ms" className="font-mono">
            {m.response_ms ?? '—'}ms
          </span>,
          <MTag key="s" tone={tone}>
            {m.status === 'idle' ? '정상' : m.status}
          </MTag>,
        ];
      });
  }, [modems]);

  return (
    <div className="animate-fadeIn">
      <MPanel title={`물리 동글 1~${I7_PHYSICAL_SLOTS} · 192.168.3.{번호}`}>
        <p className="mb-2 font-mono text-[10.5px] text-huma-t3">
          동글1~3 연운(:10001~10003) · 동글4 파나나(:10004) · 동글5 퀴즈(:10005) · C-Rank
          동글6~7(:10006~10007)
        </p>
        <MTable head={['계정', '서비스', 'IP', '지역', '응답', '상태']} rows={rows} />
        {extraRows.length > 0 && (
          <>
            <p className="mb-2 mt-4 font-mono text-[10.5px] text-huma-t3">
              슬롯 8~10 (DB만 존재 · i7 7동글 구성에서는 미사용)
            </p>
            <MTable head={['슬롯', '역할', 'IP', '지역', '응답', '상태']} rows={extraRows} />
          </>
        )}
        {modems.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {modems
              .filter((m) => m.slot_number >= 1 && m.slot_number <= I7_PHYSICAL_SLOTS)
              .sort((a, b) => a.slot_number - b.slot_number)
              .map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="btn-ghost text-[10px]"
                  onClick={() => api.reconnectModem(m.id).then(load)}
                >
                  동글 {m.slot_number} IP 재발급
                </button>
              ))}
          </div>
        )}
        <p className="mt-2 font-mono text-[10px] text-huma-t3">
          i7: /etc/huma/dongle-slot-interfaces.conf 에 물리 번호=eth 매핑 후 sudo bash
          setup-dongle-slots.sh · Supabase v3_25 마이그레이션(슬롯 6~7) 필요
        </p>
      </MPanel>
    </div>
  );
}
