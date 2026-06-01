'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HumaAccount, HumaModem } from '@huma/shared';
import {
  POSTING_DONGLE_SLOTS,
  dongleManagementIp,
  postingSlotByPort,
} from '@huma/shared';
import { api } from '@/lib/api';
import { WORKSPACES } from '@/lib/constants';
import { MPanel, MTable, MTag } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

const SLOT_SERVICE_LABEL: Record<number, string> = {
  1: '연운',
  2: '연운',
  3: '연운',
  4: '파나나',
  5: '퀴즈',
};

function accountForModem(modem: HumaModem, accounts: HumaAccount[]): HumaAccount | undefined {
  return accounts.find(
    (a) => a.account_type === 'posting' && a.proxy_port === modem.proxy_port,
  );
}

export function ModemsView() {
  const [modems, setModems] = useState<HumaModem[]>([]);
  const [accounts, setAccounts] = useState<HumaAccount[]>([]);

  const load = () => {
    Promise.all([api.modems(), api.accounts()])
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
    alert('물리 동글 1~5는 Supabase huma_modems + i7 setup-dongle-slots.sh 로 설정합니다.');
  });

  const postingModems = useMemo(
    () => modems.filter((m) => m.slot_number >= 1 && m.slot_number <= 5).sort((a, b) => a.slot_number - b.slot_number),
    [modems],
  );

  const rows = useMemo(() => {
    const list = postingModems.length >= 5 ? postingModems : POSTING_DONGLE_SLOTS.map((s) => {
      const m = modems.find((x) => x.slot_number === s.slot);
      return m ?? {
        id: `slot-${s.slot}`,
        slot_number: s.slot,
        proxy_port: s.proxyPort,
        current_ip: dongleManagementIp(s.slot),
        carrier: 'KT',
        status: 'idle' as const,
        created_at: '',
      };
    });

    return list.slice(0, 5).map((m) => {
      const slot = m.slot_number;
      const slotDef = POSTING_DONGLE_SLOTS.find((s) => s.slot === slot);
      const ac = accountForModem(m, accounts);
      const mgmtIp = dongleManagementIp(slot);
      const displayIp = m.current_ip?.startsWith('192.168.3.')
        ? m.current_ip
        : mgmtIp;
      const ws =
        slotDef?.workspace ??
        postingSlotByPort(m.proxy_port)?.workspace ??
        ac?.workspace;
      const service =
        SLOT_SERVICE_LABEL[slot] ??
        WORKSPACES.find((w) => w.id === ws)?.short ??
        '—';
      const tone =
        m.status === 'error' ? 'err' : m.status === 'reconnecting' ? 'warn' : 'ok';

      return [
        slotDef?.label ?? ac?.name ?? `동글 ${slot}`,
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
  }, [postingModems, modems, accounts]);

  return (
    <div className="animate-fadeIn">
      <MPanel title="포스팅 동글 · 물리 번호 = 192.168.3.{번호}">
        <p className="mb-2 font-mono text-[10.5px] text-huma-t3">
          동글1~3 연운(:10001~10003) · 동글4 파나나(:10004) · 동글5 퀴즈(:10005) · C-Rank 동글6~7(:10006~10007)
        </p>
        <MTable head={['계정', '서비스', 'IP', '지역', '응답', '상태']} rows={rows} />
        {modems.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {modems
              .filter((m) => m.slot_number <= 7)
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
          i7: /etc/huma/dongle-slot-interfaces.conf 에 물리 번호=eth 매핑 후 sudo bash setup-dongle-slots.sh
        </p>
      </MPanel>
    </div>
  );
}
