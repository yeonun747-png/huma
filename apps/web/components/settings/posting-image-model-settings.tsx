'use client';

import Link from 'next/link';
import { cn } from '@/lib/constants';
import {
  IMAGEN_PIPELINE_OPTIONS,
  pipelineImageCost,
  normalizeImagenPipelineChoice,
} from '@/lib/higgsfield-models';
import { usePipelineModelSettings } from '@/lib/use-pipeline-model-settings';
import { MPanel } from '@/components/mockup/primitives';

export function PostingImageModelSettings() {
  const {
    loaded,
    imgChoice,
    haikuAuto,
    setImgChoice,
    setHaikuAuto,
    saveImageSettings,
  } = usePipelineModelSettings();

  const imgCost = pipelineImageCost(imgChoice);

  return (
    <MPanel
      title={
        <>
          🖼 포스팅 이미지 설정{' '}
          <span className="ml-1 font-mono text-[9.5px] font-normal text-huma-ok">네이버 대표 이미지</span>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="font-mono text-[11px] tracking-wide text-huma-t3">
              Google Imagen 4
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-huma-t3">
              Haiku 자동 판단
              <button
                type="button"
                className={cn('m-tgl m-tgl-sm', haikuAuto && 'on')}
                aria-pressed={haikuAuto}
                disabled={!loaded}
                onClick={() => {
                  setHaikuAuto((v) => {
                    const next = !v;
                    if (next) setImgChoice('auto');
                    if (loaded) void saveImageSettings({ img: next ? 'auto' : imgChoice, haiku: next });
                    return next;
                  });
                }}
              />
            </div>
          </div>
          <select
            className="m-model-select"
            value={imgChoice}
            disabled={!loaded || haikuAuto}
            onChange={(e) => {
              const img = normalizeImagenPipelineChoice(e.target.value);
              setImgChoice(img);
              void saveImageSettings({ img });
            }}
          >
            {IMAGEN_PIPELINE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {haikuAuto ? (
            <div className="mt-1 rounded bg-huma-bg3 px-2 py-1 font-mono text-[10.5px] text-huma-t3">
              Haiku가 프롬프트 분석 → 텍스트 포함 시 Standard, 일반 시 Fast 자동 선택
            </div>
          ) : null}
        </div>

        <div className="rounded-md border border-huma-bdr bg-huma-bg3 px-2.5 py-2">
          <div className="flex justify-between text-[11.5px] text-huma-t3">
            <span>
              예상 비용 <span className="text-huma-t2">{imgCost.label}</span>
            </span>
            <span className="font-mono text-huma-t">{imgCost.display}</span>
          </div>
        </div>

        <p className="font-mono text-[10.5px] leading-relaxed text-huma-t3">
          숏폼 영상(EvoLink) 설정은{' '}
          <Link href="/video-content" className="font-semibold text-huma-acc hover:underline">
            숏폼 영상 관리
          </Link>
          에서 변경합니다.
        </p>
      </div>
    </MPanel>
  );
}
