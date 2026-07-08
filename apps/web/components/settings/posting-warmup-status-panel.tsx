'use client';

import { POSTING_DONGLE_SLOTS } from '@huma/shared';
import { cn } from '@/lib/constants';
import { formatYeonunAccountDisplayLabel } from '@/lib/yeonun-dongle-groups';

export type PostingWarmupStatusRow = {
  dongle_label?: string;
  slot_label: string;
  proxy_port?: number;
  warmup_day: number;
  phase_label: string;
  stage: string;
  weekday_cap?: number | null;
  today_target: number | null;
  is_complete: boolean;
  missing: boolean;
};

const POSTING_WARMUP_STAGES = [
  { id: 'initial' as const, label: '초기', dayRange: '0~2일', cap: 1, capLabel: '1건' },
  { id: 'adapt' as const, label: '적응', dayRange: '3~5일', cap: 2, capLabel: '2건' },
  { id: 'expand' as const, label: '확대', dayRange: '6~9일', cap: 2, capLabel: '2건' },
  { id: 'late' as const, label: '후반', dayRange: '10~14일', cap: 3, capLabel: '3건' },
  { id: 'complete' as const, label: '완료', dayRange: '15일+', cap: 3, capLabel: '3건' },
];

type CountTone = 'acc' | 'ok' | 'warn' | 't3';

function countToneForStage(stage: string, missing: boolean): CountTone {
  if (missing) return 't3';
  if (stage === 'complete') return 'ok';
  if (stage === 'late' || stage === 'expand') return 'acc';
  if (stage === 'adapt') return 'warn';
  return 't3';
}

function CountCell({
  value,
  suffix = '',
  tone = 'acc',
  className,
}: {
  value: number | string | null | undefined;
  suffix?: string;
  tone?: CountTone;
  className?: string;
}) {
  if (value == null || value === '—') {
    return <span className="font-mono text-[11px] text-huma-t3">—</span>;
  }
  const toneClass = {
    acc: 'text-huma-acc',
    ok: 'text-huma-ok',
    warn: 'text-huma-warn',
    t3: 'text-huma-t3',
  }[tone];

  return (
    <span className={cn('font-mono text-[12px] font-bold tabular-nums', toneClass, className)}>
      {value}
      {suffix ? <span className="ml-px text-[10px] font-semibold opacity-90">{suffix}</span> : null}
    </span>
  );
}

function resolveWeekdayCap(row: PostingWarmupStatusRow): number | null {
  if (row.missing) return null;
  if (row.weekday_cap != null) return row.weekday_cap;
  const stageMeta = POSTING_WARMUP_STAGES.find((s) => s.id === row.stage);
  return stageMeta?.cap ?? null;
}

/** 평일상한을 넘지 않도록 오늘 목표 표시 */
function resolveTodayTarget(
  row: PostingWarmupStatusRow,
  weekdayCap: number | null,
): number | null {
  if (row.today_target == null) return null;
  if (weekdayCap != null) return Math.min(row.today_target, weekdayCap);
  return row.today_target;
}

type EnrichedWarmupRow = PostingWarmupStatusRow & {
  dongleKey: number;
  dongleLabel: string;
  port: number;
};

/** API·레거시 응답 모두 — proxy_port / slot_label로 동글 복원 */
function enrichWarmupRow(row: PostingWarmupStatusRow): EnrichedWarmupRow {
  if (row.proxy_port != null) {
    const slot = POSTING_DONGLE_SLOTS.find((s) => s.proxyPort === row.proxy_port);
    return {
      ...row,
      proxy_port: row.proxy_port,
      dongle_label: row.dongle_label ?? slot?.label ?? row.slot_label,
      dongleKey: row.proxy_port,
      dongleLabel: row.dongle_label ?? slot?.label ?? row.slot_label,
      port: row.proxy_port,
    };
  }

  const exact = POSTING_DONGLE_SLOTS.find((s) => s.label === row.slot_label);
  if (exact) {
    return {
      ...row,
      proxy_port: exact.proxyPort,
      dongle_label: exact.label,
      dongleKey: exact.proxyPort,
      dongleLabel: exact.label,
      port: exact.proxyPort,
    };
  }

  const prefix = POSTING_DONGLE_SLOTS.find((s) => row.slot_label.startsWith(`${s.label}-`));
  if (prefix) {
    return {
      ...row,
      proxy_port: prefix.proxyPort,
      dongle_label: prefix.label,
      dongleKey: prefix.proxyPort,
      dongleLabel: prefix.label,
      port: prefix.proxyPort,
    };
  }

  return {
    ...row,
    dongleKey: -1,
    dongleLabel: row.dongle_label ?? row.slot_label,
    port: row.proxy_port ?? 0,
  };
}

/** 계정 열 — 연운 1-1 · 연운 1-2 형식 */
function accountDisplayLabel(row: EnrichedWarmupRow, indexInGroup: number): string {
  if (row.missing) return '—';
  const raw =
    row.slot_label === row.dongleLabel || row.slot_label === row.dongle_label
      ? `${row.dongleLabel}-${indexInGroup + 1}`
      : row.slot_label;
  return formatYeonunAccountDisplayLabel(raw, {
    proxyPort: row.port > 0 ? row.port : undefined,
    indexInGroup,
  });
}

function sortWarmupRows(rows: PostingWarmupStatusRow[]): EnrichedWarmupRow[] {
  const portOrder = new Map<number, number>(
    POSTING_DONGLE_SLOTS.map((s, i) => [s.proxyPort, i]),
  );
  return rows.map(enrichWarmupRow).sort((a, b) => {
    const pa = a.dongleKey >= 0 ? (portOrder.get(a.dongleKey) ?? 99) : 99;
    const pb = b.dongleKey >= 0 ? (portOrder.get(b.dongleKey) ?? 99) : 99;
    if (pa !== pb) return pa - pb;
    return a.slot_label.localeCompare(b.slot_label, 'ko');
  });
}

function groupByDongle(rows: EnrichedWarmupRow[]) {
  const groups: Array<{ key: number; label: string; port: number; rows: EnrichedWarmupRow[] }> = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.key === row.dongleKey) {
      last.rows.push(row);
    } else {
      groups.push({
        key: row.dongleKey,
        label: row.dongleLabel,
        port: row.port,
        rows: [row],
      });
    }
  }
  return groups;
}

function WarmupStageTable() {
  return (
    <div className="overflow-x-auto rounded-md border border-huma-bdr bg-huma-bg2/60">
      <table className="w-full min-w-[300px] border-collapse font-mono text-[10.5px]">
        <thead>
          <tr className="border-b border-huma-bdr bg-huma-bg3/50 text-left text-huma-t3">
            <th className="px-2 py-1.5 font-semibold">단계</th>
            <th className="px-2 py-1.5 font-semibold">일차</th>
            <th className="px-2 py-1.5 text-right font-semibold">평일 상한</th>
          </tr>
        </thead>
        <tbody>
          {POSTING_WARMUP_STAGES.map((s) => (
            <tr key={s.id} className="border-b border-huma-bdr/60 last:border-0">
              <td className="px-2 py-1 text-huma-t1">{s.label}</td>
              <td className="px-2 py-1 text-huma-t2">{s.dayRange}</td>
              <td className="px-2 py-1 text-right">
                {s.id === 'complete' ? (
                  <CountCell value={3} suffix="건" tone="ok" />
                ) : (
                  <CountCell value={s.cap} suffix="건" tone="acc" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountWarmupTable({ rows }: { rows: PostingWarmupStatusRow[] }) {
  const sorted = sortWarmupRows(rows);
  const groups = groupByDongle(sorted);

  return (
    <div className="overflow-x-auto rounded-md border border-huma-bdr bg-huma-bg2/40">
      <table className="w-full min-w-[440px] border-collapse font-mono text-[10.5px]">
        <thead>
          <tr className="border-b border-huma-bdr bg-huma-bg3/60 text-left text-huma-t3">
            <th className="px-2 py-1.5 font-semibold">동글</th>
            <th className="px-2 py-1.5 font-semibold">계정</th>
            <th className="px-2 py-1.5 font-semibold">단계</th>
            <th className="px-2 py-1.5 text-center font-semibold">일차</th>
            <th className="px-2 py-1.5 text-center font-semibold">평일상한</th>
            <th className="px-2 py-1.5 text-center font-semibold">오늘</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) =>
            group.rows.map((row, rowIdx) => {
              const tone = countToneForStage(row.stage, row.missing);
              const weekdayCap = resolveWeekdayCap(row);
              const stageMeta = POSTING_WARMUP_STAGES.find((s) => s.id === row.stage);
              const isFirstInGroup = rowIdx === 0;

              return (
                <tr
                  key={`${group.key}-${row.slot_label}-${rowIdx}`}
                  className={cn(
                    'border-b border-huma-bdr/50 last:border-0',
                    row.missing && 'bg-huma-bg3/40 text-huma-t3',
                    row.is_complete && !row.missing && 'bg-[var(--ok-bg)]/25',
                    !row.missing && !row.is_complete && 'hover:bg-huma-bg3/30',
                    isFirstInGroup && group.rows.length > 1 && 'border-t border-huma-bdr/80',
                  )}
                >
                  {isFirstInGroup ? (
                    <td
                      rowSpan={group.rows.length}
                      className="border-r border-huma-bdr/40 px-2 py-1.5 align-top font-semibold text-huma-acc"
                    >
                      <div>{group.label}</div>
                      {group.port > 0 ? (
                        <div className="mt-0.5 text-[9px] font-normal text-huma-t3">:{group.port}</div>
                      ) : null}
                      {group.rows.length > 1 ? (
                        <div className="mt-0.5 text-[9px] font-normal text-huma-t2">
                          {group.rows.length}계정
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                  <td className="px-2 py-1.5 font-semibold text-huma-t1">
                    {accountDisplayLabel(row, rowIdx)}
                  </td>
                  <td className="px-2 py-1.5 text-huma-t2">
                    {row.missing ? (
                      <span className="text-huma-t3">—</span>
                    ) : (
                      <span
                        className={cn(
                          'inline-block rounded px-1 py-px text-[10px] font-semibold',
                          row.stage === 'complete' && 'bg-[var(--ok-bg)] text-huma-ok',
                          row.stage === 'expand' && 'bg-huma-acc/10 text-huma-acc',
                          row.stage === 'late' && 'bg-huma-warn/10 text-huma-warn',
                          row.stage === 'adapt' && 'bg-huma-bg3 text-huma-t2',
                          row.stage === 'initial' && 'bg-huma-bg3 text-huma-t3',
                        )}
                      >
                        {stageMeta?.label ?? row.phase_label.split(' ')[0]}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {row.missing ? (
                      <span className="text-huma-t3">—</span>
                    ) : (
                      <CountCell value={row.warmup_day} suffix="일" tone={tone} />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <CountCell
                      value={weekdayCap}
                      suffix={weekdayCap != null ? '건' : undefined}
                      tone={tone}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {row.missing ? (
                      <span className="text-[10px] text-huma-t3">계정 없음</span>
                    ) : (
                      <CountCell
                        value={resolveTodayTarget(row, weekdayCap)}
                        suffix="건"
                        tone={row.is_complete ? 'ok' : 'acc'}
                      />
                    )}
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}

export function PostingWarmupStatusPanel({
  rows,
  loading,
  standalone = false,
}: {
  rows: PostingWarmupStatusRow[];
  loading: boolean;
  /** MPanel 제목과 함께 쓸 때 상단 구분선·중복 제목 생략 */
  standalone?: boolean;
}) {
  if (loading && !rows.length) {
    return (
      <div className={cn('font-mono text-[11px] text-huma-t3', !standalone && 'mt-3 border-t border-huma-bdr pt-3')}>
        포스팅 워밍업 현황 불러오는 중…
      </div>
    );
  }

  if (!rows.length) return null;

  return (
    <div className={cn(!standalone && 'mt-3 border-t border-huma-bdr pt-3')}>
      {!standalone ? (
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-huma-t3">
          기준표 · 단계별 상한
        </div>
      ) : null}

      <WarmupStageTable />

      <div className="mb-1.5 mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-huma-t3">
        계정별 현황
      </div>
      <AccountWarmupTable rows={rows} />
    </div>
  );
}
