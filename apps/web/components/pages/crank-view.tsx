'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HumaAccount, Workspace } from '@huma/shared';
import {
  CRANK_SERVICE_ORDER,
  crankLabelOf,
  crankServiceLabelKo,
  crankWorkspaceFromLabel,
  isCrankPoolAccount,
  sortAccountsByCrankLabel,
} from '@huma/shared';
import { cn } from '@/lib/constants';
import type { CrankActType, CrankFeedItem } from '@/lib/crank-mock-data';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { EmptyPanel } from '@/components/ui/empty-panel';
import {
  MCrankRow,
  MGrid,
  MPanel,
  MProgressStat,
  MTable,
  MTag,
  MToggle,
} from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

type SchedulerStatus = {
  date_key: string;
  active_crank_modems: number;
  planned_crank_modems?: number;
  cycle_days: number;
  daily_account_target: number;
  max_sessions_per_modem_per_day: number;
  today_scheduled: number;
  today_completed: number;
  session_duration_minutes: number;
  modems: Array<{
    id: string;
    slot_number: number;
    proxy_port: number;
    status: string;
    monthly_data_mb: number;
    crank_sessions_today: number;
    schedule_excluded: boolean;
    display_status?: string;
    probe_ok?: boolean;
    response_ms?: number | null;
    modem_role?: string;
    carrier?: string;
    current_ip?: string;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    crank_label?: string | null;
    crank_workspace?: string | null;
    is_active: boolean;
    last_crank_at: string | null;
    next_run_at: string | null;
    today_job_status: string | null;
  }>;
};

function formatKstShort(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function actTypeClass(type: CrankActType) {
  if (type === '방문') return 'm-act-visit';
  if (type === '공감') return 'm-act-like';
  if (type === '댓글') return 'm-act-comment';
  return 'm-act-follow';
}

export function CrankView() {
  const { workspace } = useWorkspace();
  const [tab, setTab] = useState<'feed' | 'ops'>('feed');
  const [serviceFilter, setServiceFilter] = useState<'all' | Workspace>('all');
  const [acctFilter, setAcctFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [targets, setTargets] = useState<Array<Record<string, unknown>>>([]);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);
  const [schedulerLoading, setSchedulerLoading] = useState(true);
  const [syncingProxy, setSyncingProxy] = useState(false);
  const [crankFeed, setCrankFeed] = useState<{
    kpi: { visit: { current: number; max: number }; like: { current: number; max: number }; comment: { current: number; max: number }; neighbor: { current: number; max: number } };
    accountCards: Array<{ id: string; label: string; count: number; sub: string }>;
    feed: CrankFeedItem[];
    keywords: string[];
    hasData?: boolean;
  } | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [crankAccounts, setCrankAccounts] = useState<HumaAccount[]>([]);
  const schedulerLoadRef = useRef(0);
  const schedulerInitialRef = useRef(true);

  const loadScheduler = useCallback(async (opts?: { probe?: boolean; background?: boolean }) => {
    const loadId = ++schedulerLoadRef.current;
    const withProbe = opts?.probe === true;
    if (!opts?.background && schedulerInitialRef.current) setSchedulerLoading(true);

    try {
      const sched = await api.crankScheduler({ probe: withProbe });
      if (loadId !== schedulerLoadRef.current) return;
      setScheduler(sched as SchedulerStatus);
      setSchedulerError(null);
      schedulerInitialRef.current = false;
    } catch (err: unknown) {
      if (loadId !== schedulerLoadRef.current) return;
      if (!opts?.background) {
        setScheduler(null);
        const msg =
          err instanceof Error ? err.message : typeof err === 'string' ? err : '스케줄러 API 실패';
        setSchedulerError(msg);
        schedulerInitialRef.current = false;
      }
    } finally {
      if (!opts?.background && loadId === schedulerLoadRef.current) setSchedulerLoading(false);
    }
  }, []);

  /** 슬롯 6·7 — 프록시 관리와 동일 /api/modems?probe=1&slots=6,7 로 DB 갱신 후 스케줄러 표시 */
  const syncCrankModems = useCallback(
    async (opts?: { background?: boolean }) => {
      const bg = opts?.background === true;
      setSyncingProxy(true);
      try {
        await api.modems({ probe: true, slots: [6, 7], timeoutMs: 60_000 });
      } catch {
        /* probe 실패해도 스케줄러는 표시 */
      }
      await loadScheduler({ background: bg });
    },
    [loadScheduler],
  );

  const syncProxyModems = useCallback(async () => {
    await syncCrankModems();
  }, [syncCrankModems]);

  const loadCrankFeed = useCallback(() => {
    setFeedLoading(true);
    void api
      .crankFeed()
      .then((data) => {
        setCrankFeed(data);
        setFeedError(null);
      })
      .catch((e: Error) => {
        setCrankFeed(null);
        setFeedError(e.message);
      })
      .finally(() => setFeedLoading(false));
  }, []);

  const loadCrankAccounts = useCallback(() => {
    void api
      .accounts()
      .then((rows) =>
        setCrankAccounts(
          sortAccountsByCrankLabel(
            rows.filter((a) => isCrankPoolAccount(a) && a.account_type === 'crank' && a.is_active),
          ),
        ),
      )
      .catch(() => setCrankAccounts([]));
  }, []);

  const load = useCallback(() => {
    void api.getSetting('social_crank').then(setConfig).catch(() => setConfig({}));
    void api.cafeTargets().then(setTargets).catch(() => setTargets([]));
    loadCrankAccounts();
    void syncCrankModems();
    loadCrankFeed();
  }, [syncCrankModems, loadCrankFeed, loadCrankAccounts]);

  useEffect(() => {
    load();
    if (schedulerError) return;
    const id = setInterval(() => {
      void loadScheduler({ background: true });
    }, 60_000);
    return () => clearInterval(id);
  }, [load, loadScheduler, schedulerError]);

  useEffect(() => {
    if (tab !== 'feed') return;
    const id = setInterval(() => loadCrankFeed(), 30_000);
    return () => clearInterval(id);
  }, [tab, loadCrankFeed]);

  useRegisterPageAction('startCrank', async () => {
    await api.createJob({
      workspace,
      job_type: 'social_crank',
      title: 'C-Rank 소통 (수동)',
      status: 'pending',
    });
    load();
  });

  const visitLimit = Number(config.daily_visit_limit ?? 200);

  const saveCfg = async (patch: Record<string, unknown>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    await api.updateSetting('social_crank', next);
  };

  const displayStatusLabel: Record<string, string> = {
    active: '가동',
    reserved: '예비·미연결',
    error: '오류',
    offline: '오프라인',
    missing: 'DB 없음',
    wrong_role: '역할 오류',
    excluded: '한도 초과',
  };

  const modemRows =
    scheduler?.modems.map((m) => {
      const ds = m.display_status ?? 'active';
      const tone =
        ds === 'active'
          ? 'ok'
          : ds === 'reserved' || ds === 'offline'
            ? 'idle'
            : 'err';
      const statusLabel = displayStatusLabel[ds] ?? m.status;
      const probeHint =
        m.slot_number <= 7 && (m.probe_ok || m.status === 'idle') && m.response_ms != null
          ? ` · SOCKS ${m.response_ms}ms`
          : m.slot_number <= 7 && (m.status === 'error' || ds === 'error')
            ? ' · 프록시 오류'
            : '';

      return [
        `동글 ${m.slot_number}`,
        `:${m.proxy_port}`,
        <span key="mb" className="font-mono">
          {Number(m.monthly_data_mb ?? 0).toFixed(1)} MB
        </span>,
        String(m.crank_sessions_today),
        <MTag key="s" tone={tone}>
          {statusLabel}
          {probeHint}
        </MTag>,
      ];
    }) ?? [];

  const accountRows =
    scheduler?.accounts.map((a) => [
      a.crank_label?.trim() ? `${a.crank_label} · ${a.name}` : a.name,
      formatKstShort(a.last_crank_at),
      formatKstShort(a.next_run_at),
      a.today_job_status ?? '—',
    ]) ?? [];

  const kpi = crankFeed?.kpi ?? { visit: { current: 0, max: 200 }, like: { current: 0, max: 150 }, comment: { current: 0, max: 50 }, neighbor: { current: 0, max: 20 } };

  const filteredCrankAccounts = useMemo(() => {
    if (serviceFilter === 'all') return crankAccounts;
    return crankAccounts.filter(
      (a) => (a.crank_workspace ?? crankWorkspaceFromLabel(a.crank_label) ?? 'yeonun') === serviceFilter,
    );
  }, [crankAccounts, serviceFilter]);

  const accountCards = useMemo(() => {
    const feed = crankFeed?.feed ?? [];
    const totalFromAccounts = filteredCrankAccounts.reduce((s, a) => s + (a.crank_count_today ?? 0), 0);
    const totalFromFeed = feed.filter((f) => f.type === '방문').length;
    const total = Math.max(totalFromAccounts, totalFromFeed);

    return [
      {
        id: 'all',
        label: '전체',
        count: total,
        sub: `${filteredCrankAccounts.length}계정`,
      },
      ...filteredCrankAccounts.map((a) => {
        const key = crankLabelOf(a);
        const fromFeed = feed.filter((f) => (f.acctKey ?? f.acct) === key).length;
        const svc = a.crank_workspace ?? crankWorkspaceFromLabel(a.crank_label);
        return {
          id: key,
          label: key,
          count: fromFeed > 0 ? fromFeed : (a.crank_count_today ?? 0),
          sub: svc ? crankServiceLabelKo(svc) : (a.name !== key ? a.name : a.proxy_port ? `:${a.proxy_port}` : 'CRANK'),
        };
      }),
    ];
  }, [filteredCrankAccounts, crankFeed]);

  const feedRows = useMemo(() => {
    const source = crankFeed?.feed ?? [];
    return source.filter((row) => {
      if (acctFilter !== 'all' && (row.acctKey ?? row.acct) !== acctFilter) return false;
      if (typeFilter !== 'all' && row.type !== typeFilter) return false;
      return true;
    });
  }, [acctFilter, typeFilter, crankFeed]);

  return (
    <div className="animate-fadeIn">
      <div className="mb-3 flex gap-1 rounded-md bg-huma-bg3 p-0.5">
        {([
          ['feed', '피드'],
          ['ops', '운영'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex-1 rounded px-3 py-1.5 text-[12.5px] font-medium transition',
              tab === id ? 'bg-huma-acc font-bold text-white' : 'text-huma-t3 hover:text-huma-t2',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'feed' && (
        <>
          {feedError && (
            <p className="mb-2 rounded border border-huma-err bg-[var(--err-bg)] px-3 py-2 text-[12px] text-huma-err">
              피드 API 오류: {feedError}
            </p>
          )}
          {feedLoading && !crankFeed && (
            <EmptyPanel message="C-Rank 활동 데이터 로딩 중…" />
          )}
          <MGrid cols={4}>
            <MProgressStat label="블로그 방문" current={kpi.visit.current} max={kpi.visit.max} />
            <MProgressStat label="공감" current={kpi.like.current} max={kpi.like.max} />
            <MProgressStat label="댓글" current={kpi.comment.current} max={kpi.comment.max} />
            <MProgressStat label="이웃 신청" current={kpi.neighbor.current} max={kpi.neighbor.max} />
          </MGrid>

          <MPanel
            title={
              <>
                C-Rank 계정별 오늘 활동
                <span className="ml-2 font-mono text-[10px] font-normal normal-case tracking-normal text-huma-t3">
                  클릭 → 해당 계정 피드만 필터
                </span>
              </>
            }
          >
            <div className="mb-2 flex flex-wrap gap-1">
              <button
                type="button"
                className={cn('rounded px-2 py-0.5 text-[11px]', serviceFilter === 'all' ? 'bg-huma-acc text-white' : 'bg-huma-bg3 text-huma-t3')}
                onClick={() => {
                  setServiceFilter('all');
                  setAcctFilter('all');
                }}
              >
                전체 ({crankAccounts.length})
              </button>
              {CRANK_SERVICE_ORDER.map((ws) => {
                const count = crankAccounts.filter(
                  (a) => (a.crank_workspace ?? crankWorkspaceFromLabel(a.crank_label) ?? 'yeonun') === ws,
                ).length;
                return (
                  <button
                    key={ws}
                    type="button"
                    className={cn(
                      'rounded px-2 py-0.5 text-[11px]',
                      serviceFilter === ws ? 'bg-huma-acc text-white' : 'bg-huma-bg3 text-huma-t3',
                    )}
                    onClick={() => {
                      setServiceFilter(ws);
                      setAcctFilter('all');
                    }}
                  >
                    {crankServiceLabelKo(ws)} ({count})
                  </button>
                );
              })}
            </div>
            <div className="grid max-h-[280px] grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-6 lg:grid-cols-8">
              {filteredCrankAccounts.length === 0 && !feedLoading ? (
                <p className="col-span-full py-3 text-center text-[12px] text-huma-t3">
                  등록된 CRANK 소통 계정이 없습니다.{' '}
                  <a href="/accounts" className="text-huma-acc underline">
                    계정 관리
                  </a>
                  에서 account_type=crank 계정을 추가하세요.
                </p>
              ) : null}
              {accountCards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setAcctFilter(card.id)}
                  className={cn('m-acct-card', acctFilter === card.id && 'on')}
                >
                  <div className="m-ac-id">{card.label}</div>
                  <div className="m-ac-cnt">{card.count}</div>
                  <div className="m-ac-svc">{card.sub}</div>
                </button>
              ))}
            </div>
          </MPanel>

          <MPanel
            title={
              <>
                활동 피드
                <select
                  className="ml-auto rounded border border-huma-bdr bg-huma-bg3 px-1.5 py-0.5 font-mono text-[11px] text-huma-t2"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="all">전체 유형</option>
                  <option value="방문">방문</option>
                  <option value="공감">공감</option>
                  <option value="댓글">댓글</option>
                  <option value="이웃">이웃신청</option>
                </select>
              </>
            }
          >
            {feedRows.length === 0 ? (
              <EmptyPanel message="오늘 C-Rank 활동 기록이 없습니다. 스케줄러 또는 수동 실행 후 표시됩니다." />
            ) : (
              feedRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  data-acct={row.acctKey ?? row.acct}
                  className="m-act-row w-full text-left"
                  onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                >
                  <span className={cn('m-act-type', actTypeClass(row.type))}>{row.type}</span>
                  <div className="min-w-0 flex-1">
                    <div className="m-act-title">{row.title}</div>
                    <div className="m-act-sub">{row.sub}</div>
                    {row.expand && expandedId === row.id && <div className="m-act-expand open">{row.expand}</div>}
                  </div>
                  <span className="m-act-time">{row.time}</span>
                </button>
              ))
            )}
          </MPanel>

          <MPanel title="소통 자동화 설정">
            <MToggle
              label="타 블로그 방문·공감"
              sub={`일 ${visitLimit}건 · 가우시안 딜레이`}
              value={Boolean(config.enabled ?? true)}
              onChange={(v) => saveCfg({ enabled: v })}
            />
            <MToggle
              label="AI 자동 댓글 (Claude Haiku)"
              sub="게시글 본문 읽고 자연어 동적 생성"
              value={Boolean(config.auto_comment ?? true)}
              onChange={(v) => saveCfg({ auto_comment: v })}
            />
            <MToggle
              label="이웃 자동 신청"
              sub="사주·운세 블로그 타겟"
              value={Boolean(config.auto_neighbor ?? true)}
              onChange={(v) => saveCfg({ auto_neighbor: v })}
            />
            <MToggle
              label="카페 소통"
              sub="점사모 카페 댓글·공감"
              value={Boolean(config.cafe_enabled ?? false)}
              onChange={(v) => saveCfg({ cafe_enabled: v })}
            />
            <button
              type="button"
              className="btn-ghost btn-sm mt-2"
              onClick={() =>
                api.createJob({
                  workspace,
                  job_type: 'social_crank',
                  title: 'C-Rank 소통 (수동)',
                  status: 'pending',
                }).then(load)
              }
            >
              ▶ 수동 1회 실행
            </button>
          </MPanel>
        </>
      )}

      {tab === 'ops' && (
        <>
      <MPanel title="C-Rank 스케줄러 · social_crank">
        {scheduler ? (
          <MGrid cols={4}>
            <MProgressStat
              label="가동 crank 동글"
              current={scheduler.active_crank_modems}
              max={scheduler.planned_crank_modems ?? 2}
            />
            <MProgressStat
              label={`활동 주기 (${scheduler.cycle_days}일)`}
              current={scheduler.today_completed}
              max={scheduler.today_scheduled || scheduler.daily_account_target}
            />
            <MProgressStat
              label="오늘 예정 / 완료"
              current={scheduler.today_completed}
              max={Math.max(scheduler.today_scheduled, scheduler.daily_account_target)}
            />
            <MProgressStat
              label="세션 단위"
              current={scheduler.session_duration_minutes}
              max={60}
            />
          </MGrid>
        ) : (
          <div>
            <EmptyPanel
              message={
                schedulerLoading
                  ? '스케줄러 상태를 불러오는 중…'
                  : schedulerError
                    ? `스케줄러 상태를 불러오지 못했습니다. ${schedulerError}`
                    : '스케줄러 상태를 불러오지 못했습니다. (원인 미상 — 웹·API 재배포 후 다시 시도)'
              }
            />
            {schedulerError && !schedulerLoading && (
              <button
                type="button"
                className="mt-2 text-xs text-huma-accent underline"
                onClick={() => {
                  setSchedulerError(null);
                  schedulerInitialRef.current = true;
                  load();
                }}
              >
                다시 시도
              </button>
            )}
          </div>
        )}
        <p className="mt-2 font-mono text-[10.5px] text-huma-t3">
          매일 00:01 KST 큐 생성 · 08:00~22:00 분산(±15분) · 세션 60분 · 동글당 일 6세션·월 2500MB ·
          예비 슬롯(8~10)은 스케줄 제외 · 슬롯 6·7은 프록시 관리와 동일 SOCKS probe
          {syncingProxy ? ' (검사 중…)' : ''}
          {!syncingProxy && (
            <>
              {' '}
              (
              <button
                type="button"
                className="text-huma-accent underline"
                onClick={() => void syncProxyModems()}
              >
                다시 검사
              </button>
              )
            </>
          )}
        </p>
        {scheduler && (
          <>
            <p className="mb-2 mt-3 text-xs text-huma-t2">
              오늘({scheduler.date_key}) 목표 {scheduler.daily_account_target}계정 · 가동 동글{' '}
              {scheduler.active_crank_modems}개(목표 {scheduler.planned_crank_modems ?? 2}개) ·{' '}
              {scheduler.cycle_days}일 주기
            </p>
            <MTable
              head={['동글', 'SOCKS', '월 데이터', '오늘 세션', '상태']}
              rows={modemRows}
            />
            <MTable
              head={['계정', '마지막 crank', '다음 예정', '오늘 job']}
              rows={accountRows}
            />
          </>
        )}
      </MPanel>

      <MPanel title="소통 대상 목록">
        {targets.length === 0 ? (
          <EmptyPanel message="소통 대상이 없습니다. 카페 크롤링을 실행하세요." />
        ) : (
          targets.map((t, i) => (
            <MCrankRow
              key={String(t.id ?? i)}
              icon={String(t.cafe_id ?? '') === 'jeomsamo' ? '🏛' : '📝'}
              title={String(t.post_title ?? t.post_url ?? '대상')}
              sub={String(t.post_url ?? '')}
              status={t.is_replied ? '완료' : '대기'}
              statusTone={t.is_replied ? 'ok' : 'idle'}
            />
          ))
        )}
        <button
          type="button"
          className="btn-ghost mt-2 w-full py-2 text-xs"
          onClick={() => api.crawlCafe().then(load)}
        >
          점사모 신규글 크롤링
        </button>
      </MPanel>
        </>
      )}
    </div>
  );
}
