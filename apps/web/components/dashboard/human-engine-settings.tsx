'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/constants';
import {
  DEFAULT_VIDEO_MODEL,
  HUMAN_ENGINE_IMAGE_LABEL,
  normalizeVideoModel,
} from '@/lib/higgsfield-models';
import { useHumanEngineSave } from '@/components/dashboard/human-engine-save-context';

type Range = [number, number];

interface HumanEngineConfig {
  wpm_mean: number;
  wpm_sigma: number;
  typo_rate: number;
  backspace_delay_ms: Range;
  paragraph_pause_ms: Range;
  review_duration_ms: Range;
  active_hours: number[];
  weekend_ratio: number;
  min_publish_interval_hours: number;
  crank_publish_ratio: number;
  crank_comm_ratio: number;
  fingerprint: {
    canvas_spoof: boolean;
    webgl_spoof: boolean;
    audio_noise: boolean;
    mouse_bezier: boolean;
    click_jitter_px: number;
    auto_pause_on_detect: boolean;
    captcha_slack: boolean;
    cooldown_429_hours: number;
  };
}

interface ImageEngineConfig {
  noise_pct: number;
  jpeg_quality_range: Range;
  exif_randomize: boolean;
  gps_randomize: boolean;
  block_duplicate: boolean;
}

interface MediaConfig {
  default_video_model: string;
  whisper_subtitle_sync: boolean;
}

/** v3.12: Shorts 파이프라인 영상 해상도 720p 고정 (9:16) */
const FIXED_VIDEO_RESOLUTION = '720p';
const FIXED_VIDEO_DIMENSIONS = '720×1280 · 9:16';

/** 목업 initHuman() intensity 배열 */
const MOCKUP_ACTIVE_HOURS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.7, 0.9, 0.8, 0.4, 0.3, 0.6, 0.9, 1.0, 0.9, 0.8, 0.5, 0.8, 0.95, 0.9, 0.6,
];

const DEFAULT_HUMAN: HumanEngineConfig = {
  wpm_mean: 55,
  wpm_sigma: 18,
  typo_rate: 0.04,
  backspace_delay_ms: [200, 800],
  paragraph_pause_ms: [2000, 8000],
  review_duration_ms: [120000, 300000],
  active_hours: MOCKUP_ACTIVE_HOURS,
  weekend_ratio: 0.5,
  min_publish_interval_hours: 4,
  crank_publish_ratio: 1,
  crank_comm_ratio: 3,
  fingerprint: {
    canvas_spoof: true,
    webgl_spoof: true,
    audio_noise: true,
    mouse_bezier: true,
    click_jitter_px: 3,
    auto_pause_on_detect: true,
    captcha_slack: true,
    cooldown_429_hours: 2,
  },
};

const DEFAULT_IMAGE: ImageEngineConfig = {
  noise_pct: 0.8,
  jpeg_quality_range: [90, 96],
  exif_randomize: true,
  gps_randomize: true,
  block_duplicate: true,
};

const DEFAULT_MEDIA: MediaConfig = {
  default_video_model: DEFAULT_VIDEO_MODEL,
  whisper_subtitle_sync: true,
};

function mergeHuman(raw: Record<string, unknown>): HumanEngineConfig {
  const fp = (raw.fingerprint as Record<string, unknown>) ?? {};
  const hours = raw.active_hours as number[] | undefined;
  return {
    ...DEFAULT_HUMAN,
    ...raw,
    fingerprint: { ...DEFAULT_HUMAN.fingerprint, ...fp },
    active_hours: hours?.length === 24 ? hours : MOCKUP_ACTIVE_HOURS,
  } as HumanEngineConfig;
}

function wpmBars(mean: number, sigma: number) {
  const bins = 20;
  const min = Math.max(10, mean - sigma * 3);
  const max = mean + sigma * 3;
  const step = (max - min) / bins;
  const vals: number[] = [];
  for (let i = 0; i < bins; i++) {
    const x = min + step * (i + 0.5);
    vals.push(Math.exp(-0.5 * ((x - mean) / sigma) ** 2));
  }
  const mx = Math.max(...vals);
  return vals.map((v) => ({ height: Math.round((v / mx) * 100), opacity: 0.3 + (v / mx) * 0.7 }));
}

function HeSliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const display = step < 1 ? `${value.toFixed(1)}${suffix}` : `${value}${suffix}`;
  return (
    <div className="he-slider-row">
      <span className="he-slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="he-range"
      />
      <span className="he-slider-val">{display}</span>
    </div>
  );
}

function HeStaticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="he-slider-row">
      <span className="he-slider-label">{label}</span>
      <span className="he-slider-static">{value}</span>
    </div>
  );
}

function HeToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="he-tw">
      <span className="he-tw-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={cn('he-tgl', value && 'he-tgl-on')}
      >
        <span className="he-tgl-knob" />
      </button>
    </div>
  );
}

export function HumanEngineSettings() {
  const [human, setHuman] = useState<HumanEngineConfig>(DEFAULT_HUMAN);
  const [image, setImage] = useState<ImageEngineConfig>(DEFAULT_IMAGE);
  const [media, setMedia] = useState<MediaConfig>(DEFAULT_MEDIA);
  const saveCtx = useHumanEngineSave();

  useEffect(() => {
    Promise.all([
      api.getSetting('human_engine').catch(() => ({})),
      api.getSetting('image_engine').catch(() => ({})),
      api.getSetting('higgsfield').catch(() => ({})),
      api.getSetting('watcher').catch(() => ({})),
    ]).then(([h, img, higgs, watcher]) => {
      const merged = mergeHuman(h as Record<string, unknown>);
      const w = watcher as Record<string, unknown>;
      if (w.auto_pause !== undefined) merged.fingerprint.auto_pause_on_detect = Boolean(w.auto_pause);
      if (w.cooldown_429_min !== undefined) merged.fingerprint.cooldown_429_hours = Number(w.cooldown_429_min) / 60;
      setHuman(merged);
      setImage({ ...DEFAULT_IMAGE, ...(img as object), block_duplicate: (img as ImageEngineConfig).block_duplicate ?? true });
      const hg = higgs as Record<string, unknown>;
      setMedia({
        default_video_model: normalizeVideoModel(String(hg.default_video_model ?? DEFAULT_VIDEO_MODEL)),
        whisper_subtitle_sync: Boolean(hg.whisper_subtitle_sync ?? true),
      });
    });
  }, []);

  const chartBars = useMemo(() => wpmBars(human.wpm_mean, human.wpm_sigma), [human.wpm_mean, human.wpm_sigma]);

  const persist = useCallback(async () => {
    await Promise.all([
      api.updateSetting('human_engine', human),
      api.updateSetting('image_engine', image),
      api.updateSetting('higgsfield', {
        default_video_model: normalizeVideoModel(media.default_video_model),
        aspect_ratio: '9:16',
        default_video_resolution: FIXED_VIDEO_RESOLUTION,
        whisper_subtitle_sync: media.whisper_subtitle_sync,
      }),
      api.updateSetting('watcher', {
        auto_pause: human.fingerprint.auto_pause_on_detect,
        cooldown_429_min: human.fingerprint.cooldown_429_hours * 60,
        captcha_slack: human.fingerprint.captcha_slack,
      }),
    ]);
  }, [human, image, media]);

  useEffect(() => {
    if (!saveCtx) return;
    return saveCtx.register(persist);
  }, [saveCtx, persist]);

  return (
    <div className="animate-fadeIn">
      <div className="he-g2">
        <div className="panel he-panel">
          <div className="he-panel-t">■ 타이핑 엔진 (가우시안 분포)</div>
          <HeSliderRow label="평균 속도 (WPM)" value={human.wpm_mean} min={30} max={90} onChange={(v) => setHuman((h) => ({ ...h, wpm_mean: v }))} />
          <HeSliderRow label="속도 편차 (σ)" value={human.wpm_sigma} min={2} max={30} onChange={(v) => setHuman((h) => ({ ...h, wpm_sigma: v }))} />
          <HeSliderRow
            label="오타 발생률"
            value={Math.round(human.typo_rate * 100)}
            min={1}
            max={10}
            suffix="%"
            onChange={(v) => setHuman((h) => ({ ...h, typo_rate: v / 100 }))}
          />
          <HeStaticRow label="백스페이스 딜레이" value="200~800ms" />
          <HeStaticRow label="문단 간 사고 정지" value="2~8초" />
          <HeStaticRow label="발행 전 검토" value="2~5분" />
          <div className="he-wpm-chart">
            {chartBars.map((bar, i) => (
              <div key={i} className="he-wpm-bar" style={{ height: `${bar.height}%`, opacity: bar.opacity }} />
            ))}
          </div>
          <div className="he-chart-caption">WPM 분포 시뮬레이션 (가우시안)</div>
        </div>

        <div className="panel he-panel">
          <div className="he-panel-t">■ 활성 시간대 히트맵</div>
          <div className="he-hm-labels">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="he-hm-l">
                {h}시
              </div>
            ))}
          </div>
          <div className="he-heatmap">
            {human.active_hours.map((v, h) => (
              <div
                key={h}
                className="he-hm-cell"
                style={
                  v > 0
                    ? { background: 'var(--acc)', opacity: (0.12 + v * 0.88).toFixed(2) }
                    : undefined
                }
                title={`${h}시 활성도 ${Math.round(v * 100)}%`}
              />
            ))}
          </div>
          <div className="he-heatmap-stats">
            <HeStaticRow label="주말 발행량" value="평일 50%" />
            <HeStaticRow label="연속 발행 간격" value="최소 4시간" />
            <HeStaticRow label="C-Rank 소통비율" value="발행1 : 소통3" />
          </div>
        </div>
      </div>

      <div className="he-g2">
        <div className="panel he-panel">
          <div className="he-panel-t">○ 감지 방어 · 핑거프린트</div>
          <HeToggle label="Canvas 해시 스푸핑" value={human.fingerprint.canvas_spoof} onChange={(v) => setHuman((h) => ({ ...h, fingerprint: { ...h.fingerprint, canvas_spoof: v } }))} />
          <HeToggle label="WebGL 렌더러 변조" value={human.fingerprint.webgl_spoof} onChange={(v) => setHuman((h) => ({ ...h, fingerprint: { ...h.fingerprint, webgl_spoof: v } }))} />
          <HeToggle label="AudioContext 노이즈" value={human.fingerprint.audio_noise} onChange={(v) => setHuman((h) => ({ ...h, fingerprint: { ...h.fingerprint, audio_noise: v } }))} />
          <HeToggle label="마우스 베지어 이동" value={human.fingerprint.mouse_bezier} onChange={(v) => setHuman((h) => ({ ...h, fingerprint: { ...h.fingerprint, mouse_bezier: v } }))} />
          <div className="he-tw">
            <span className="he-tw-label">클릭 좌표 오차</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={10}
                value={human.fingerprint.click_jitter_px}
                onChange={(e) =>
                  setHuman((h) => ({
                    ...h,
                    fingerprint: { ...h.fingerprint, click_jitter_px: parseFloat(e.target.value) },
                  }))
                }
                className="he-range-sm"
              />
              <span className="he-jitter-val">±{human.fingerprint.click_jitter_px}px</span>
            </div>
          </div>
          <HeToggle label="탐지 시 자동 일시정지" value={human.fingerprint.auto_pause_on_detect} onChange={(v) => setHuman((h) => ({ ...h, fingerprint: { ...h.fingerprint, auto_pause_on_detect: v } }))} />
          <HeToggle label="캡차 감지 → Slack 알림" value={human.fingerprint.captcha_slack} onChange={(v) => setHuman((h) => ({ ...h, fingerprint: { ...h.fingerprint, captcha_slack: v } }))} />
          <div className="he-tw">
            <span className="he-tw-label">429 이후 쿨다운</span>
            <span className="he-meta-val">{human.fingerprint.cooldown_429_hours}시간</span>
          </div>
        </div>

        <div className="panel he-panel">
          <div className="he-panel-t">■ 이미지 고유화</div>
          <HeSliderRow
            label="픽셀 노이즈 강도"
            value={image.noise_pct}
            min={0}
            max={5}
            step={0.1}
            suffix="%"
            onChange={(v) => setImage((img) => ({ ...img, noise_pct: v }))}
          />
          <HeToggle label="EXIF 기기 정보 랜덤화" value={image.exif_randomize} onChange={(v) => setImage((img) => ({ ...img, exif_randomize: v }))} />
          <HeToggle label="EXIF GPS 랜덤 주입" value={image.gps_randomize} onChange={(v) => setImage((img) => ({ ...img, gps_randomize: v }))} />
          <HeStaticRow label="JPEG 품질 범위" value="90~96%" />
          <HeToggle label="중복 이미지 차단" value={image.block_duplicate} onChange={(v) => setImage((img) => ({ ...img, block_duplicate: v }))} />
          <HeStaticRow label="기본 이미지 모델" value={HUMAN_ENGINE_IMAGE_LABEL} />
          <div className="he-chart-caption">v3.26 · Imagen 4 + Kling 3.0 내장 오디오 (TTS 기본 미사용)</div>
          <HeStaticRow label="영상 해상도" value={`${FIXED_VIDEO_DIMENSIONS} · ${FIXED_VIDEO_RESOLUTION} 고정`} />
          <HeToggle
            label="자막 자동 싱크 (Whisper)"
            value={media.whisper_subtitle_sync}
            onChange={(v) => setMedia((m) => ({ ...m, whisper_subtitle_sync: v }))}
          />
        </div>
      </div>
    </div>
  );
}
