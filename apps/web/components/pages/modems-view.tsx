'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HumaAccount, HumaModem } from '@huma/shared';
import {
  CRANK_PHONE_SLOTS,
  POSTING_DONGLE_SLOTS,
  dongleManagementIp,
  postingSlotByPort,
} from '@huma/shared';
import { api } from '@/lib/api';
import { appAlert, appConfirm } from '@/lib/app-dialog';
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

function isPhoneModem(m: HumaModem): boolean {
  return m.carrier === 'phone' || m.proxy_port >= 10006;
}

function modemStatusTag(
  m: HumaModem,
  opts?: { probing?: boolean; reconnecting?: boolean },
): { label: string; tone: 'ok' | 'warn' | 'err' | 'idle' } {
  if (opts?.probing) return { label: '검사중', tone: 'idle' };
  if (opts?.reconnecting) return { label: '재발급중', tone: 'warn' };
  if (m.status === 'error') return { label: '오류', tone: 'err' };
  if (m.status === 'reconnecting') return { label: '재연결', tone: 'warn' };
  if (m.status === 'offline') {
    return isPhoneModem(m)
      ? { label: '오류', tone: 'err' }
      : { label: '오프라인', tone: 'idle' };
  }
  if (m.status === 'busy') return { label: '사용중', tone: 'warn' };
  if (m.status === 'idle' && !m.public_ip && m.response_ms == null) return { label: '대기', tone: 'idle' };
  if (m.status === 'idle' && !m.public_ip && m.response_ms != null) {
    return { label: '오류', tone: 'err' };
  }
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
  6: 'C-Rank 실폰',
  7: 'C-Rank 실폰',
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
  ...CRANK_PHONE_SLOTS.map((s) => ({
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
      current_ip: def.slot <= 5 ? dongleManagementIp(def.slot) : undefined,
      carrier: def.slot <= 5 ? 'KT' : 'phone',
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
  const [reconnectingSlot, setReconnectingSlot] = useState<number | null>(null);
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
      const [base, acc] = await Promise.all([api.modems({ force: true }), api.accounts()]);
      if (probeGenRef.current !== gen) return;
      setModems(base);
      setAccounts(acc);
      await runSlotProbes(base, gen, { silent: true });
    } catch (err: unknown) {
      if (probeGenRef.current !== gen) return;
      const msg = err instanceof Error ? err.message : '프록시 목록 로드 실패';
      setLoadError(msg);
    }
  }, [runSlotProbes]);

  /** DB 목록 갱신 후 7슬롯 순차 SOCKS probe — 「다시 검사」·복구 후 */
  const recheckAll = useCallback(async () => {
    const gen = ++probeGenRef.current;
    setLoadError(null);
    try {
      const [base, acc] = await Promise.all([api.modems(), api.accounts()]);
      if (probeGenRef.current !== gen) return;
      setModems(base);
      setAccounts(acc);
      await runSlotProbes(base, gen);
    } catch (err: unknown) {
      if (probeGenRef.current !== gen) return;
      const msg = err instanceof Error ? err.message : '프록시 검사 실패';
      setLoadError(msg);
    }
  }, [runSlotProbes]);

  const restoreNetwork = useCallback(async () => {
    if (
      !(await appConfirm(
        '동글 DHCP · policy routing · 3proxy를 일괄 복구합니다.\n1~2분 걸릴 수 있습니다. 계속할까요?',
      ))
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
      await appAlert(res.message ?? '복구 완료. SOCKS 재검사를 실행합니다.');
      await recheckAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '동글 네트워크 복구 실패';
      setLoadError(msg);
      await appAlert(msg);
    } finally {
      setRestoring(false);
    }
  }, [recheckAll]);

  const reconnectSlot = useCallback(async (modem: HumaModem) => {
    const slot = modem.slot_number;
    const oldPublicIp = modem.public_ip?.trim() || '';
    const oldLabel = oldPublicIp || modem.current_ip?.trim() || '—';

    if (
      !(await appConfirm(
        `동글 ${slot} IP를 재발급합니다.\n현재 IP: ${oldLabel}\nLTE 리셋·SOCKS 갱신에 1~2분 걸릴 수 있습니다. 계속할까요?`,
      ))
    ) {
      return;
    }

    setReconnectingSlot(slot);
    setLoadError(null);
    try {
      await api.reconnectModem(modem.id);

      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4_000));
        const list = await api.modems({ force: true });
        setModems(list);
        const cur = list.find((x) => x.slot_number === slot);
        if (!cur || cur.status !== 'reconnecting') break;
      }

      const probed = await api.modems({
        probe: true,
        slots: [slot],
        timeoutMs: PER_SLOT_PROBE_MS,
      });
      setModems((prev) => mergeProbedModems(prev, probed));
      const updated = probed.find((x) => x.slot_number === slot);

      if (!updated) {
        await appAlert(`동글 ${slot} 상태를 확인할 수 없습니다. 「다시 검사」를 실행하세요.`);
        return;
      }

      const newPublicIp = updated.public_ip?.trim() || '';
      const newLabel = newPublicIp || updated.current_ip?.trim() || '—';

      if (updated.status === 'error') {
        await appAlert(`동글 ${slot} IP 재발급 실패 (상태: 오류).\nOperation Log를 확인하세요.`);
      } else if (oldPublicIp && newPublicIp && newPublicIp !== oldPublicIp) {
        await appAlert(`동글 ${slot} IP 재발급 완료.\n${oldPublicIp} → ${newPublicIp}`);
      } else if (newPublicIp) {
        await appAlert(`동글 ${slot} 재발급 완료.\n공인 IP: ${newPublicIp}`);
      } else if (newLabel !== '—') {
        await appAlert(`동글 ${slot} 재발급 완료.\n인터페이스 IP: ${newLabel}`);
      } else {
        await appAlert(
          `동글 ${slot} 재발급이 종료되었습니다.\n공인 IP를 가져오지 못했습니다. 「다시 검사」로 확인하세요.`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'IP 재발급 요청 실패';
      setLoadError(msg);
      await appAlert(msg);
    } finally {
      setReconnectingSlot(null);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      probeGenRef.current += 1;
    };
  }, [load]);

  useRegisterPageAction('openModemForm', () => {
    void appAlert(
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
        reconnecting: reconnectingSlot === slot,
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
  }, [modems, accounts, probingSlot, reconnectingSlot]);

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
          허브 동글 1~5 · 직결 실폰 6~7 · 슬롯별 SOCKS+공인IP+지역 순차 probe (슬롯당 최대 ~90초) ·
          재부팅 직후 동글 1~5는 첫 naver SOCKS가 cold start로 ~10s 나올 수 있음(실폰은 enx 직결·빠름) ·
          연운(:10001~10003) · 파나나(:10004) · 퀴즈(:10005) · C-Rank 실폰(:10006~10007)
          {probingSlot != null ? (
            <span className="text-huma-accent"> · 동글 {probingSlot} 검사중</span>
          ) : null}
          {!probing && !restoring && (
            <>
              {' '}
              (
              <button type="button" className="text-huma-accent underline" onClick={() => void recheckAll()}>
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
          <div className="mt-3 flex flex-wrap gap-1">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={restoring || probing || reconnectingSlot != null}
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
                  className="btn-ghost modem-reconnect-btn text-[10px]"
                  disabled={restoring || probing || reconnectingSlot != null}
                  onClick={() => void reconnectSlot(m)}
                >
                  {reconnectingSlot === m.slot_number
                    ? `동글 ${m.slot_number} 재발급중…`
                    : `동글 ${m.slot_number} IP 재발급`}
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
