'use client';

import { cn } from '@/lib/constants';

export type PostingWarmupStageId = 'initial' | 'adapt' | 'expand' | 'late' | 'complete' | 'missing';

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

function resolveStageIndex(stage: string): number {
  const idx = POSTING_WARMUP_STAGES.findIndex((s) => s.id === stage);
  return idx >= 0 ? idx : -1;
}

function WarmupStageTrack({ stage, missing }: { stage: string; missing: boolean }) {
  const currentIdx = missing ? -1 : resolveStageIndex(stage);

  return (
    <div className="flex items-center gap-1" aria-hidden>
      {POSTING_WARMUP_STAGES.map((s, i) => {
        const isCurrent = !missing && i === currentIdx;
        const isPast = !missing && currentIdx >= 0 && i < currentIdx;
        return (
          <div
            key={s.id}
            title={`${s.label} (${s.dayRange} · ${s.cap})`}
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full border transition-transform',
              missing && 'border-huma-bdr bg-huma-bg3 opacity-40',
              !missing && isPast && 'border-huma-ok/60 bg-huma-ok/35',
              !missing &&
                isCurrent &&
                'scale-110 border-huma-acc bg-huma-acc shadow-[0_0_0_2px_rgba(236,72,153,0.25)]',
              !missing && !isPast && !isCurrent && 'border-huma-bdr bg-transparent opacity-35',
            )}
          />
        );
      })}
    </div>
  );
}

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
}: {
  rows: PostingWarmupStatusRow[];
  loading: boolean;
}) {
  if (loading && !rows.length) {
    return (
      <div className="mt-3 border-t border-huma-bdr pt-3 font-mono text-[11px] text-huma-t3">
        포스팅 워밍업 현황 불러오는 중…
      </div>
    );
  }

  if (!rows.length) return null;

  return (
    <div className="mt-3 border-t border-huma-bdr pt-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-huma-t3">
        포스팅 워밍업 단계
      </div>

      <WarmupStageTable />

      <div className="mt-2 mb-1.5 font-mono text-[10px] text-huma-t3">
        ● 현재 단계 · ○ 미도달 · 녹색 = 지나간 단계
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {rows.map((row) => {
          const stageMeta = POSTING_WARMUP_STAGES.find((s) => s.id === row.stage);
          const stageLabel = row.missing ? '—' : (stageMeta?.label ?? row.stage);

          return (
            <div
              key={row.slot_label}
              className={cn(
                'rounded-md border px-2 py-1.5',
                row.missing
                  ? 'border-huma-bdr/80 bg-huma-bg2/40'
                  : row.is_complete
                    ? 'border-huma-ok/30 bg-huma-ok/5'
                    : 'border-huma-acc/25 bg-huma-acc/5',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span
                  className={cn(
                    'font-mono text-[11px] font-bold',
                    row.missing ? 'text-huma-t3' : 'text-huma-t1',
                  )}
                >
                  {row.slot_label}
                </span>
                <WarmupStageTrack stage={row.stage} missing={row.missing} />
              </div>
              <div
                className={cn(
                  'mt-1 font-mono text-[10.5px]',
                  row.missing ? 'text-huma-t3' : row.is_complete ? 'text-huma-ok' : 'text-huma-acc',
                )}
              >
                {row.missing ? (
                  '계정 없음'
                ) : (
                  <>
                    <span className="font-bold">{stageLabel}</span>
                    <span className="text-huma-t3"> · </span>
                    <span>{row.warmup_day}일차</span>
                    {stageMeta ? (
                      <>
                        <span className="text-huma-t3"> · </span>
                        <span className="text-huma-t2">평일 {stageMeta.cap}</span>
                      </>
                    ) : null}
                    {row.today_target != null ? (
                      <>
                        <span className="text-huma-t3"> · </span>
                        <span className="text-huma-t1">오늘 {row.today_target}건</span>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
