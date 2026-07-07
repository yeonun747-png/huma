'use client';

import { useEffect, useState } from 'react';
import type { NarrationScriptProgress } from '@huma/shared';
import { formatElapsedDurationSec } from '@/lib/video-content-status';

function useElapsedSec(sinceIso: string | null | undefined, active: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active || !sinceIso) {
      setElapsed(0);
      return;
    }
    const start = new Date(sinceIso).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sinceIso, active]);

  return elapsed;
}

export function NarrationGeneratingPanel({
  topicLabel,
  progress,
}: {
  topicLabel: string;
  progress: NarrationScriptProgress;
}) {
  const elapsedSec = useElapsedSec(progress.sinceAt, true);
  const percent = progress.percent;

  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center py-8 text-center">
      <div className="mb-4 w-full max-w-[320px]">
        <div className="mb-1.5 flex justify-between font-mono text-[10px] text-huma-t4">
          <span>진행률</span>
          <span className="font-semibold text-huma-accent">{percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-huma-bg3">
          <div
            className="h-full rounded-full bg-huma-accent transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <div className="animate-pulse text-[14px] font-semibold text-huma-t2">대본 생성 중</div>
      <p className="mt-2 max-w-md px-4 font-mono text-[11px] leading-relaxed text-huma-t2">
        {progress.label}
      </p>
      <p className="mt-2 text-[10px] text-huma-t4">「{topicLabel}」</p>

      {progress.sinceAt ? (
        <p className="mt-4 font-mono text-[12px] font-semibold text-huma-accent">
          경과 {formatElapsedDurationSec(elapsedSec)}
        </p>
      ) : null}

      <p className="mt-4 max-w-sm px-6 text-[10px] leading-relaxed text-huma-t4">
        Sonnet이 나레이션 대본을 작성합니다. 완료되면 「검토 대기」 탭으로 이동합니다.
      </p>
    </div>
  );
}
