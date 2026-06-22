'use client';

import {
  DEFAULT_VIDEO_MODEL,
  PIPELINE_VIDEO_DURATION_OPTIONS,
  PIPELINE_VIDEO_QUALITY_OPTIONS,
  getPipelineVideoOption,
  normalizePipelineVideoQuality,
  pipelineVideoCost,
} from '@/lib/higgsfield-models';
import { usePipelineModelSettings } from '@/lib/use-pipeline-model-settings';
import { MPanel } from '@/components/mockup/primitives';

const SETTING_LABEL_CLASS = 'font-mono text-[11px] tracking-wide text-huma-t3';

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
          <div className={`mb-1 ${SETTING_LABEL_CLASS}`}>
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
            <div className={`mb-1 ${SETTING_LABEL_CLASS}`}>
              영상길이 | 멀티샷 · 720p $0.106/초 · 1080p $0.133/초 · 음성 포함
            </div>
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
        </div>

        <div className={`flex justify-between ${SETTING_LABEL_CLASS}`}>
          <span>예상 비용 {vidCost.durationLabel}</span>
          <span className="text-huma-t">{vidCost.usdDisplay}</span>
        </div>
      </div>
    </MPanel>
  );
}
