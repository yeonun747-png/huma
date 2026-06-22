'use client';

import { cn } from '@/lib/constants';

export type PostingWarmupStatusRow = {
  slot_label: string;
  warmup_day: number;
  phase_label: string;
  stage: string;
  today_target: number | null;
  is_complete: boolean;
  missing: boolean;
};

const POSTING_WARMUP_STAGES = [
  { id: 'initial' as const, label: '초기', dayRange: '0~2일', cap: '1건' },
  { id: 'adapt' as const, label: '적응', dayRange: '3~5일', cap: '2건' },
  { id: 'expand' as const, label: '확대', dayRange: '6~9일', cap: '3건' },
  { id: 'late' as const, label: '후반', dayRange: '10~14일', cap: '4건' },
  { id: 'complete' as const, label: '완료', dayRange: '15일+', cap: '4~5건' },
];

function WarmupStageTable() {
  return (
    <div className="overflow-x-auto rounded-md border border-huma-bdr bg-huma-bg2/60">
      <table className="w-full min-w-[280px] border-collapse font-mono text-[10.5px]">
        <thead>
          <tr className="border-b border-huma-bdr text-left text-huma-t3">
            <th className="px-2 py-1.5 font-semibold">단계</th>
            <th className="px-2 py-1.5 font-semibold">일차</th>
            <th className="px-2 py-1.5 font-semibold">평일 상한</th>
          </tr>
        </thead>
        <tbody>
          {POSTING_WARMUP_STAGES.map((s) => (
            <tr key={s.id} className="border-b border-huma-bdr/60 last:border-0">
              <td className="px-2 py-1 text-huma-t1">{s.label}</td>
              <td className="px-2 py-1 text-huma-t2">{s.dayRange}</td>
              <td className="px-2 py-1 text-huma-acc">{s.cap}</td>
            </tr>
          ))}
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
          포스팅 워밍업 단계
        </div>
      ) : null}

      <WarmupStageTable />

      <div className="mt-2 flex flex-col gap-1.5">
        {rows.map((row) => {
          const stageMeta = POSTING_WARMUP_STAGES.find((s) => s.id === row.stage);
          const stageLabel = row.missing ? '—' : (stageMeta?.label ?? row.stage);

          return (
            <div
              key={row.slot_label}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5',
                row.missing
                  ? 'border-huma-bdr/80 bg-huma-bg2/40'
                  : row.is_complete
                    ? 'border-huma-ok/30 bg-huma-ok/5'
                    : 'border-huma-acc/25 bg-huma-acc/5',
              )}
            >
              <span className="min-w-0 truncate font-mono text-[10.5px]">
                <span className={cn('font-bold', row.missing ? 'text-huma-t3' : 'text-huma-t1')}>
                  {row.slot_label}
                </span>
                {row.missing ? (
                  <span className="text-huma-t3"> · 계정 없음</span>
                ) : (
                  <>
                    <span className="text-huma-t4"> · </span>
                    <span className="text-huma-t2">
                      <span className="font-bold tabular-nums text-huma-acc">{row.warmup_day}</span>
                      일차
                    </span>
                    {stageMeta ? (
                      <>
                        <span className="text-huma-t4"> · </span>
                        <span className="text-huma-t3">평일 </span>
                        <span className="font-bold tabular-nums text-huma-warn">
                          {stageMeta.cap.replace(/건$/, '')}
                        </span>
                        <span className="text-huma-t3">건</span>
                      </>
                    ) : null}
                    {row.today_target != null ? (
                      <>
                        <span className="text-huma-t4"> · </span>
                        <span className="text-huma-t3">오늘 </span>
                        <span className="font-bold tabular-nums text-huma-ok">{row.today_target}</span>
                        <span className="text-huma-t3">건</span>
                      </>
                    ) : null}
                  </>
                )}
              </span>
              <span
                className={cn(
                  'shrink-0 font-mono text-[11px] font-bold tracking-tight',
                  row.missing && 'text-huma-t3',
                  !row.missing && row.is_complete && 'text-huma-ok',
                  !row.missing && !row.is_complete && 'text-huma-acc',
                )}
              >
                {stageLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
