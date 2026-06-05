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
/** 목업: 289ms 지연, 200ms 이하 정상 */
const PROBE_DELAY_MS = 220;

function maskPublicIp(ip: string): string {
  const parts = ip.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.x`;
  return ip;
}

function modemStatusTag(m: HumaModem): { label: string; tone: 'ok' | 'warn' | 'err' | 'idle' } {
  if (m.status === 'error') return { label: '오류', tone: 'err' };
  if (m.status === 'reconnecting') return { label: '재연결', tone: 'warn' };
  if (m.status === 'offline') return { label: '오프라인', tone: 'idle' };
  if (m.response_ms != null && m.response_ms > PROBE_DELAY_MS) return { label: '지연', tone: 'warn' };
  if (m.status === 'idle') return { label: '정상', tone: 'ok' };
  return { label: m.status, tone: 'idle' };
}

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
      const ws =
        def.workspace ??
        postingSlotByPort(m.proxy_port)?.workspace ??
        ac?.workspace;
      const service =
        SLOT_SERVICE_LABEL[slot] ??
        WORKSPACES.find((w) => w.id === ws)?.short ??
        '—';
      const { label: statusLabel, tone } = modemStatusTag(m);
      const publicIp = m.public_ip?.trim();
      const displayIp = publicIp ? maskPublicIp(publicIp) : '—';
      const region = m.geo_region?.trim() || '—';
      const msTone = tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'err';

      return [
        ac?.name ?? def.label ?? `동글 ${slot}`,
        service,
        <span
          key="ip"
          className="font-mono"
          title={
            publicIp
              ? `${publicIp} · 동글 ${slot} · SOCKS :${m.proxy_port}`
              : `동글 ${slot} · SOCKS :${m.proxy_port} · probe 대기`
          }
        >
          {displayIp}
        </span>,
        region,
        <span key="ms" className={`font-mono ${msTone}`}>
          {m.response_ms != null ? `${m.response_ms}ms` : '—'}
        </span>,
        <MTag key="s" tone={tone}>
          {statusLabel}
        </MTag>,
      ];
    });
  }, [modems, accounts]);

  const extraRows = useMemo(() => {
    return modems
      .filter((m) => m.slot_number > I7_PHYSICAL_SLOTS && m.slot_number <= 10)
      .sort((a, b) => a.slot_number - b.slot_number)
      .map((m) => {
        const { label: statusLabel, tone } = modemStatusTag(m);
        const publicIp = m.public_ip?.trim();
        return [
          `슬롯 ${m.slot_number}`,
          m.modem_role ?? '—',
          <span key="ip" className="font-mono" title={publicIp ?? `SOCKS :${m.proxy_port}`}>
            {publicIp ? maskPublicIp(publicIp) : '—'}
          </span>,
          m.geo_region?.trim() || '—',
          <span key="ms" className="font-mono">
            {m.response_ms != null ? `${m.response_ms}ms` : '—'}
          </span>,
          <MTag key="s" tone={tone}>
            {statusLabel}
          </MTag>,
        ];
      });
  }, [modems]);

  return (
    <div className="animate-fadeIn">
      <MPanel title="RESIDENTIAL PROXY · 계정별 고정 IP">
        <p className="mb-2 font-mono text-[10.5px] text-huma-t3">
          물리 동글 1~{I7_PHYSICAL_SLOTS} · SOCKS probe 시 LTE 공인 IP·지역 표시 · 연운(:10001~10003)
          · 파나나(:10004) · 퀴즈(:10005) · C-Rank(:10006~10007)
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
