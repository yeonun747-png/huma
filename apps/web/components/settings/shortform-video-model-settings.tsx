'use client';

import Link from 'next/link';
import {
  DEFAULT_VIDEO_MODEL,
  PIPELINE_VIDEO_DURATION_OPTIONS,
  PIPELINE_VIDEO_HINT,
  PIPELINE_VIDEO_QUALITY_OPTIONS,
  getPipelineAudioCopy,
  getPipelineVideoOption,
  normalizePipelineVideoQuality,
  pipelineVideoCost,
} from '@/lib/higgsfield-models';
import { usePipelineModelSettings } from '@/lib/use-pipeline-model-settings';
import { MPanel } from '@/components/mockup/primitives';

export function ShortformVideoModelSettings() {
  const {
    loaded,
    videoDurationSec,
    videoQuality,
    setVideoDurationSec,
    setVideoQuality,
    saveVideoSettings,
  } = usePipelineModelSettings();

  const vidCost = pipelineVideoCost(DEFAULT_VIDEO_MODEL, videoDurationSec, videoQuality);
  const audioCopy = getPipelineAudioCopy(DEFAULT_VIDEO_MODEL);
  const pipelineVideoDisplayName = getPipelineVideoOption(DEFAULT_VIDEO_MODEL).displayName;

  return (
    <MPanel
      title={
        <>
          🎬 숏폼 영상 설정{' '}
          <span className="ml-1 font-mono text-[9.5px] font-normal text-huma-ok">EvoLink · 전역 적용</span>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <div>
          <div className="mb-1 font-mono text-[11px] tracking-wide text-huma-t3">
            영상 모델 <span className="text-huma-acc">{pipelineVideoDisplayName}</span>
          </div>
          <select
            className="m-model-select"
            value={videoQuality}
            disabled={!loaded}
            onChange={(e) => {
              const quality = normalizePipelineVideoQuality(e.target.value);
              setVideoQuality(quality);
              void saveVideoSettings({ quality });
            }}
          >
            {PIPELINE_VIDEO_QUALITY_OPTIONS.map((o) => (
              <option key={o.quality} value={o.quality}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="mt-2">
            <div className="mb-1 font-mono text-[10px] text-huma-t3">영상 길이</div>
            <select
              className="m-model-select"
              value={videoDurationSec}
              disabled={!loaded}
              onChange={(e) => {
                const durationSec = Number(e.target.value);
                setVideoDurationSec(durationSec);
                void saveVideoSettings({ durationSec });
              }}
            >
              {PIPELINE_VIDEO_DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}초
                </option>
              ))}
            </select>
          </div>
          <div className="mt-1 rounded bg-[var(--ok-bg)] px-2 py-1 font-mono text-[10px] text-huma-ok">
            {PIPELINE_VIDEO_HINT}
          </div>
        </div>

        <div>
          <div className="mb-1 font-mono text-[11px] tracking-wide text-huma-t3">오디오</div>
          <div className="flex items-center gap-2.5 rounded-md border border-[rgba(78,203,113,0.25)] bg-[var(--ok-bg)] px-2.5 py-2">
            <div className="text-[17px]">{audioCopy.emoji}</div>
            <div>
              <div className="text-[13px] font-semibold text-huma-ok">{audioCopy.title}</div>
              <div className="font-mono text-[11px] text-huma-t3">{audioCopy.sub}</div>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-huma-bdr bg-huma-bg3 px-2.5 py-2">
          <div className="flex justify-between text-[11.5px] text-huma-t3">
            <span>
              예상 비용 {vidCost.durationLabel}
            </span>
            <span className="font-mono text-huma-t">{vidCost.usdDisplay}</span>
          </div>
        </div>

        <p className="font-mono text-[10.5px] leading-relaxed text-huma-t3">
          네이버 포스팅 이미지(Imagen) 설정은{' '}
          <Link href="/queue" className="font-semibold text-huma-acc hover:underline">
            포스팅 큐 관리
          </Link>
          에서 변경합니다.
        </p>
      </div>
    </MPanel>
  );
}
