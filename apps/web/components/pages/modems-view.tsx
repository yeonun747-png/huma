'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const PROBE_SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;
/** 슬롯당 SOCKS(~45s)+공인IP+Geo (i7 SSH 기준 ~40~90초) */
const PER_SLOT_PROBE_MS = 150_000;

function mergeProbedModems(existing: HumaModem[], fromApi: HumaModem[]): HumaModem[] {
  const bySlot = new Map(
    (existing.length > 0 ? existing : fromApi).map((m) => [m.slot_number, m]),
  );
  for (const m of fromApi) {
    const cur = bySlot.get(m.slot_number);
    bySlot.set(m.slot_number, cur ? { ...cur, ...m } : m);
  }
  return [...bySlot.values()].sort((a, b) => a.slot_number - b.slot_number);
}

/** SOCKS probe 진행 중 — 검사중 텍스트 바운스 + 점 3개 */
function ModemProbingLabel() {
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      <span className="inline-block animate-bounce" style={{ animationDuration: '0.9s' }}>
        검사중
      </span>
      <span className="inline-flex items-end pb-px" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block animate-bounce text-[11px] leading-none"
            style={{ animationDelay: `${i * 0.14}s`, animationDuration: '0.55s' }}
          >
            ·
          </span>
        ))}
      </span>
    </span>
  );
}

function modemStatusTag(
  m: HumaModem,
  opts?: { probing?: boolean },
): { label: string; tone: 'ok' | 'warn' | 'err' | 'idle' } {
  if (opts?.probing) return { label: '검사중', tone: 'idle' };
  if (m.status === 'error') return { label: '오류', tone: 'err' };
  if (m.status === 'reconnecting') return { label: '재연결', tone: 'warn' };
  if (m.status === 'offline') return { label: '오프라인', tone: 'idle' };
  if (m.status === 'busy') return { label: '사용중', tone: 'warn' };
  if (m.status === 'idle' && !m.public_ip && m.response_ms == null) return { label: '대기', tone: 'idle' };
  if (m.status === 'idle' && m.public_ip) return { label: '정상', tone: 'ok' };
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [probingSlot, setProbingSlot] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const probeGenRef = useRef(0);

  const runSlotProbes = useCallback(async (base: HumaModem[], gen: number, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setProbing(true);
    try {
      for (const slot of PROBE_SLOTS) {
        if (probeGenRef.current !== gen) return;
        setProbingSlot(slot);
        try {
          const probed = await api.modems({
            probe: true,
            slots: [slot],
            timeoutMs: PER_SLOT_PROBE_MS,
          });
          if (probeGenRef.current !== gen) return;
          setModems((prev) => mergeProbedModems(prev.length ? prev : base, probed));
        } catch {
          /* 다음 슬롯 계속 */
        }
      }
    } finally {
      if (probeGenRef.current === gen) {
        if (!opts?.silent) setProbing(false);
        setProbingSlot(null);
      }
    }
  }, []);

  const load = useCallback(async () => {
    const gen = ++probeGenRef.current;
    setLoadError(null);
    setProbing(false);
    setProbingSlot(null);
    try {
      const [base, acc] = await Promise.all([api.modems(), api.accounts()]);
      if (probeGenRef.current !== gen) return;
      setModems(base);
      setAccounts(acc);
      void runSlotProbes(base, gen, { silent: true });
    } catch (err: unknown) {
      if (probeGenRef.current !== gen) return;
      const msg = err instanceof Error ? err.message : '프록시 목록 로드 실패';
      setLoadError(msg);
    }
  }, [runSlotProbes]);

  const restoreNetwork = useCallback(async () => {
    if (
      !window.confirm(
        '동글 DHCP · policy routing · 3proxy를 일괄 복구합니다.\n1~2분 걸릴 수 있습니다. 계속할까요?',
      )
    ) {
      return;
    }
    setRestoring(true);
    setLoadError(null);
    try {
      const res = await api.restoreModemNetwork();
      if (!res.success) {
        throw new Error(res.error ?? '복구 실패');
      }
      window.alert(res.message ?? '복구 완료. SOCKS 재검사를 실행합니다.');
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '동글 네트워크 복구 실패';
      setLoadError(msg);
      window.alert(msg);
    } finally {
      setRestoring(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      probeGenRef.current += 1;
    };
  }, [load]);

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
      const { label: statusLabel, tone } = modemStatusTag(m, {
        probing: probingSlot === slot,
      });
      const publicIp = m.public_ip?.trim();
      const displayIp = publicIp || '—';
      const region = m.geo_region?.trim() || '—';
      const msTone =
        m.status === 'error' ? 'err' : m.response_ms != null && m.response_ms > 50_000 ? 'warn' : 'ok';
      const accountLabel = def.label ?? `동글 ${slot}`;
      const accountTitle =
        ac?.name && ac.name !== accountLabel ? `${accountLabel} · 계정 ${ac.name}` : accountLabel;

      return [
        <span key="acct" title={accountTitle}>
          {accountLabel}
        </span>,
        service,
        <span
          key="ip"
          className="font-mono"
          title={
            publicIp
              ? `공인 ${publicIp} · SOCKS :${m.proxy_port}`
              : m.status === 'error'
                ? `SOCKS 실패 · :${m.proxy_port}`
                : `동글 ${slot} · :${m.proxy_port} · probe 대기`
          }
        >
          {displayIp}
        </span>,
        region,
        <span key="ms" className={`font-mono ${msTone}`}>
          {m.response_ms != null ? `${m.response_ms}ms` : '—'}
        </span>,
        <MTag key="s" tone={tone}>
          {probingSlot === slot ? <ModemProbingLabel /> : statusLabel}
        </MTag>,
      ];
    });
  }, [modems, accounts, probingSlot]);

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
            {publicIp || '—'}
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
          물리 동글 1~{I7_PHYSICAL_SLOTS} · 슬롯별 SOCKS+공인IP+지역 순차 probe (슬롯당 최대 ~90초) ·
          연운(:10001~10003) · 파나나(:10004) · 퀴즈(:10005) · C-Rank(:10006~10007)
          {probingSlot != null ? (
            <span className="text-huma-accent"> · 동글 {probingSlot} 검사중</span>
          ) : null}
          {!probing && !restoring && (
            <>
              {' '}
              (
              <button type="button" className="text-huma-accent underline" onClick={() => void load()}>
                다시 검사
              </button>
              )
            </>
          )}
          {restoring ? <span className="text-huma-accent"> · 네트워크 복구 중…</span> : null}
        </p>
        {loadError && (
          <p className="mb-2 text-xs text-huma-err">
            {loadError}
            <button type="button" className="ml-2 underline" onClick={() => void load()}>
              재시도
            </button>
          </p>
        )}
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
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={restoring || probing}
              onClick={() => void restoreNetwork()}
            >
              {restoring ? '복구 중…' : '🔧 동글 네트워크 일괄 복구'}
            </button>
            {modems
              .filter((m) => m.slot_number >= 1 && m.slot_number <= I7_PHYSICAL_SLOTS)
              .sort((a, b) => a.slot_number - b.slot_number)
              .map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="btn-ghost text-[10px]"
                  disabled={restoring}
                  onClick={() => api.reconnectModem(m.id).then(load)}
                >
                  동글 {m.slot_number} IP 재발급
                </button>
              ))}
          </div>
        )}
        <p className="mt-2 font-mono text-[10px] text-huma-t3">
          응답 ms = SOCKS naver probe 소요(보통 30~45초·LTE) · <strong>오류</strong> = SOCKS 연결 실패(느려서
          아님, 타임아웃 45초) · IP — = probe 실패 · 지역 = 표시된 공인 IP 기준(ip-api·ipwho.is, LTE Geo는
          참고용) · UI 오류만으로 포스팅 큐가 막히지는 않으나 SOCKS 불가 시 작업 실행 중 실패할 수 있음
        </p>
        <p className="mt-1 font-mono text-[10px] text-huma-t3">
          <strong>오류가 계속되면</strong> 「동글 네트워크 일괄 복구」(DHCP·routing·3proxy) → 「다시 검사」 순서.
          단일 슬롯만 IP 바꿀 때는 「IP 재발급」.
        </p>
      </MPanel>
    </div>
  );
}
