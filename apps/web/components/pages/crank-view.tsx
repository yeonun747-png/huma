'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

export function CrankView() {
  const { workspace } = useWorkspace();
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [targets, setTargets] = useState<Array<Record<string, unknown>>>([]);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);
  const [schedulerLoading, setSchedulerLoading] = useState(true);
  const [syncingProxy, setSyncingProxy] = useState(false);
  const schedulerLoadRef = useRef(0);
  const schedulerInitialRef = useRef(true);

  const loadScheduler = useCallback(async () => {
    const loadId = ++schedulerLoadRef.current;
    if (schedulerInitialRef.current) setSchedulerLoading(true);

    try {
      const sched = await api.crankScheduler();
      if (loadId !== schedulerLoadRef.current) return;
      setScheduler(sched as SchedulerStatus);
      setSchedulerError(null);
      schedulerInitialRef.current = false;
    } catch (err: unknown) {
      if (loadId !== schedulerLoadRef.current) return;
      setScheduler(null);
      const msg =
        err instanceof Error ? err.message : typeof err === 'string' ? err : '스케줄러 API 실패';
      setSchedulerError(msg);
      schedulerInitialRef.current = false;
    } finally {
      if (loadId === schedulerLoadRef.current) setSchedulerLoading(false);
    }
  }, []);

  const syncProxyModems = useCallback(async () => {
    setSyncingProxy(true);
    try {
      await api.modems({ probe: true });
      await loadScheduler();
    } finally {
      setSyncingProxy(false);
    }
  }, [loadScheduler]);

  const load = useCallback(() => {
    void api.getSetting('social_crank').then(setConfig).catch(() => setConfig({}));
    void api.cafeTargets().then(setTargets).catch(() => setTargets([]));
    void loadScheduler();
  }, [loadScheduler]);

  useEffect(() => {
    load();
    if (schedulerError) return;
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load, schedulerError]);

  useRegisterPageAction('startCrank', async () => {
    await api.createJob({
      workspace,
      job_type: 'social_crank',
      title: 'C-Rank 소통 (수동)',
      status: 'pending',
    });
    load();
  });

  const daily = Number(config.daily_limit_per_account ?? 30);
  const visitLimit = Number(config.daily_visit_limit ?? 200);
  const likeLimit = Number(config.daily_like_limit ?? 150);
  const commentLimit = Number(config.daily_comment_limit ?? 50);
  const neighborLimit = Number(config.daily_neighbor_limit ?? 20);

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
        m.slot_number <= 7 && m.status === 'idle' && m.response_ms != null
          ? ` · SOCKS ${m.response_ms}ms`
          : m.slot_number <= 7 && m.status === 'error'
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
      a.name,
      formatKstShort(a.last_crank_at),
      formatKstShort(a.next_run_at),
      a.today_job_status ?? '—',
    ]) ?? [];

  return (
    <div className="animate-fadeIn">
      <MPanel title="C-Rank 스케줄러 · social_crank">
        {scheduler ? (
          <MGrid cols={4}>
            <MProgressStat
              label="가동 crank 동글"
              current={scheduler.active_crank_modems}
              max={scheduler.planned_crank_modems ?? 5}
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
                  void loadScheduler();
                }}
              >
                다시 시도
              </button>
            )}
          </div>
        )}
        <p className="mt-2 font-mono text-[10.5px] text-huma-t3">
          매일 00:01 KST 큐 생성 · 08:00~22:00 분산(±15분) · 세션 60분 · 동글당 일 6세션·월 2500MB ·
          예비 슬롯(8~10)은 스케줄 제외 · 슬롯 6·7 상태는{' '}
          <button
            type="button"
            className="text-huma-accent underline disabled:opacity-50"
            disabled={syncingProxy}
            onClick={() => void syncProxyModems()}
          >
            {syncingProxy ? '프록시 검사 중…' : '프록시 관리 DB 기준'}
          </button>
          (불일치 시 클릭해 동기화)
        </p>
        {scheduler && (
          <>
            <p className="mb-2 mt-3 text-xs text-huma-t2">
              오늘({scheduler.date_key}) 목표 {scheduler.daily_account_target}계정 · 가동 동글{' '}
              {scheduler.active_crank_modems}개(목표 {scheduler.planned_crank_modems ?? 5}개) ·{' '}
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

      <MGrid cols={4}>
        <MProgressStat label="오늘 방문" current={0} max={visitLimit} />
        <MProgressStat label="공감" current={0} max={likeLimit} />
        <MProgressStat label="댓글" current={0} max={commentLimit} />
        <MProgressStat label="이웃 신청" current={0} max={neighborLimit} />
      </MGrid>
      <MGrid cols={2}>
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
        <MPanel title="소통 자동화 설정">
          <MToggle
            label="타 블로그 방문·공감"
            sub={`일 ${visitLimit}건 · 가우시안 딜레이`}
            value={Boolean(config.enabled ?? true)}
            onChange={(v) => saveCfg({ enabled: v })}
          />
          <MToggle
            label="AI 자동 댓글"
            sub="Claude API · 자연어 변형"
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
          <div className="mt-2 font-mono text-[10.5px] text-huma-t3">일일 한도: {daily}건/계정</div>
        </MPanel>
      </MGrid>
    </div>
  );
}
