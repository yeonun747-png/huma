'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { REVIEW_DURATION_SUMMARY } from '@/lib/review-duration';
import { api } from '@/lib/api';
import { cn } from '@/lib/constants';
import { DEFAULT_VIDEO_MODEL, HUMAN_ENGINE_IMAGE_LABEL } from '@/lib/higgsfield-models';

type Range = [number, number];

interface HumanEngineConfig {
  wpm_mean: number;
  wpm_sigma: number;
  typo_rate: number;
  backspace_delay_ms: Range;
  paragraph_pause_ms: Range;
  review_duration_ms: Range;
  /** 본문 단락 Ctrl+V 비율 (0~1). 타이핑 비율 = 100% − 복붙% */
  paste_ratio?: number;
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
    captcha_telegram: boolean;
    captcha_vision_auto: boolean;
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
  paste_ratio: 0.55,
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
    captcha_telegram: true,
    captcha_vision_auto: false,
  },
};

const DEFAULT_IMAGE: ImageEngineConfig = {
  noise_pct: 0.3,
  jpeg_quality_range: [90, 96],
  exif_randomize: true,
  gps_randomize: true,
  block_duplicate: true,
};

const DEFAULT_MEDIA: MediaConfig = {
  whisper_subtitle_sync: true,
};

function snapStep(value: number, step: number): number {
  if (step >= 1) return Math.round(value);
  const decimals = String(step).includes('.') ? String(step).split('.')[1]!.length : 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mergeHuman(raw: Record<string, unknown>): HumanEngineConfig {
  const fp = (raw.fingerprint as Record<string, unknown>) ?? {};
  const hours = raw.active_hours as number[] | undefined;
  return {
    ...DEFAULT_HUMAN,
    ...raw,
    wpm_mean: Math.round(Number(raw.wpm_mean) || DEFAULT_HUMAN.wpm_mean),
    wpm_sigma: Math.round(Number(raw.wpm_sigma) || DEFAULT_HUMAN.wpm_sigma),
    typo_rate: Math.min(0.1, Math.max(0, Math.round(Number(raw.typo_rate ?? DEFAULT_HUMAN.typo_rate) * 1000) / 1000)),
    paste_ratio:
      typeof raw.paste_ratio === 'number'
        ? Math.min(1, Math.max(0, Math.round(raw.paste_ratio * 100) / 100))
        : DEFAULT_HUMAN.paste_ratio,
    fingerprint: {
      ...DEFAULT_HUMAN.fingerprint,
      ...fp,
      click_jitter_px: Math.round(Number(fp.click_jitter_px) || DEFAULT_HUMAN.fingerprint.click_jitter_px),
    },
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
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  const display = step < 1 ? `${value.toFixed(1)}${suffix}` : `${value}${suffix}`;
  return (
    <div className="he-field">
      <div className="he-slider-row">
        <span className="he-slider-label">{label}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(snapStep(parseFloat(e.target.value), step))}
          className="he-range"
        />
        <span className="he-slider-val">{display}</span>
      </div>
      {hint ? <p className="he-field-hint">{hint}</p> : null}
    </div>
  );
}

function HeStaticRow({
  label,
  value,
  hint,
  nowrap,
}: {
  label: string;
  value: string;
  hint?: string;
  nowrap?: boolean;
}) {
  return (
    <div className="he-field">
      <div className={cn('he-slider-row', nowrap && 'he-slider-row-nowrap')}>
        <span className="he-slider-label">{label}</span>
        <span className="he-slider-static">{value}</span>
      </div>
      {hint ? <p className="he-field-hint">{hint}</p> : null}
    </div>
  );
}

function HeToggle({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: boolean;
  hint?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="he-field">
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
      {hint ? <p className="he-field-hint">{hint}</p> : null}
    </div>
  );
}

export function HumanEngineSettings() {
  const [human, setHuman] = useState<HumanEngineConfig>(DEFAULT_HUMAN);
  const [image, setImage] = useState<ImageEngineConfig>(DEFAULT_IMAGE);
  const [media, setMedia] = useState<MediaConfig>(DEFAULT_MEDIA);
  const humanRef = useRef(human);
  const imageRef = useRef(image);
  const mediaRef = useRef(media);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  humanRef.current = human;
  imageRef.current = image;
  mediaRef.current = media;

  useEffect(() => {
    Promise.all([
      api.getSetting('human_engine').catch(() => ({})),
      api.getSetting('image_engine').catch(() => ({})),
      api.getSetting('higgsfield').catch(() => ({})),
    ]).then(([h, img, higgs]) => {
      const merged = mergeHuman(h as Record<string, unknown>);
      setHuman(merged);
      humanRef.current = merged;
      const mergedImage = {
        ...DEFAULT_IMAGE,
        ...(img as object),
        block_duplicate: (img as ImageEngineConfig).block_duplicate ?? true,
        noise_pct: snapStep(Number((img as ImageEngineConfig).noise_pct ?? DEFAULT_IMAGE.noise_pct), 0.1),
      };
      setImage(mergedImage);
      imageRef.current = mergedImage;
      const hg = higgs as Record<string, unknown>;
      const nextMedia = {
        whisper_subtitle_sync: Boolean(hg.whisper_subtitle_sync ?? true),
      };
      setMedia(nextMedia);
      mediaRef.current = nextMedia;
      hydrated.current = true;
    });
  }, []);

  const chartBars = useMemo(() => wpmBars(human.wpm_mean, human.wpm_sigma), [human.wpm_mean, human.wpm_sigma]);
  const pastePct = Math.round((human.paste_ratio ?? 0.55) * 100);
  const typePct = 100 - pastePct;
  const typoPct = Math.round(human.typo_rate * 100);

  const persistAll = useCallback(
    async (h: HumanEngineConfig, img: ImageEngineConfig, med: MediaConfig) => {
      await Promise.all([
        api.updateSetting('human_engine', h),
        api.updateSetting('image_engine', img),
        api.updateSetting('higgsfield', {
          default_image_model: 'imagen-4.0-fast-generate-001',
          default_video_model: DEFAULT_VIDEO_MODEL,
          aspect_ratio: '9:16',
          default_video_resolution: FIXED_VIDEO_RESOLUTION,
          video_duration_sec: 15,
          whisper_subtitle_sync: med.whisper_subtitle_sync,
        }),
      ]);
    },
    [],
  );

  const scheduleSave = useCallback(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persistAll(humanRef.current, imageRef.current, mediaRef.current);
    }, 500);
  }, [persistAll]);

  const saveNow = useCallback(
    (h: HumanEngineConfig, img: ImageEngineConfig, med: MediaConfig) => {
      if (!hydrated.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void persistAll(h, img, med);
    },
    [persistAll],
  );

  return (
    <div className="animate-fadeIn">
      <div className="he-g2">
        <div className="panel he-panel">
          <div className="he-panel-t">■ 타이핑 엔진 (가우시안 분포)</div>
          <HeSliderRow label="평균 속도 (WPM)" value={human.wpm_mean} min={30} max={90} onChange={(v) => { setHuman((h) => { const next = { ...h, wpm_mean: v }; humanRef.current = next; return next; }); scheduleSave(); }} />
          <HeSliderRow label="속도 편차 (σ)" value={human.wpm_sigma} min={2} max={30} onChange={(v) => { setHuman((h) => { const next = { ...h, wpm_sigma: v }; humanRef.current = next; return next; }); scheduleSave(); }} />
          <HeSliderRow
            label="오타 발생률"
            value={typoPct}
            min={0}
            max={10}
            suffix="%"
            onChange={(v) => { setHuman((h) => { const next = { ...h, typo_rate: v / 100 }; humanRef.current = next; return next; }); scheduleSave(); }}
          />
          <HeSliderRow
            label="본문 복붙 비율"
            value={pastePct}
            min={0}
            max={100}
            suffix="%"
            onChange={(v) => {
              setHuman((h) => {
                const next = { ...h, paste_ratio: v / 100 };
                humanRef.current = next;
                return next;
              });
              scheduleSave();
            }}
          />
          <HeStaticRow label="본문 타이핑 비율" value={`${typePct}% (자동)`} />
          <HeStaticRow
            label="제목 · 본문 타이핑"
            value={
              typoPct <= 0
                ? 'pressSequentially 유니코드 (오타 없음)'
                : `pressSequentially + 인접음절 오타·Space·Backspace×2 (${typoPct}%)`
            }
          />
          <HeStaticRow label="해시태그" value="항상 IME 타이핑 (오타 없음)" />
          <HeStaticRow
            label="백스페이스 딜레이"
            value={typoPct <= 0 ? '오타 0% — 미사용' : '200~800ms (오타 보정 시)'}
          />
          <HeStaticRow label="문단 간 사고 정지" value="2~8초" />
          <HeStaticRow label="발행전검토" value={REVIEW_DURATION_SUMMARY} nowrap />
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
          <HeToggle label="Canvas 해시 스푸핑" hint="브라우저 Canvas 지문을 세션마다 살짝 바꿔 자동화 탐지를 줄입니다." value={human.fingerprint.canvas_spoof} onChange={(v) => { setHuman((h) => { const next = { ...h, fingerprint: { ...h.fingerprint, canvas_spoof: v } }; humanRef.current = next; saveNow(next, imageRef.current, mediaRef.current); return next; }); }} />
          <HeToggle label="WebGL 렌더러 변조" hint="GPU·렌더러 정보를 변조해 같은 PC 패턴이 반복 노출되지 않게 합니다." value={human.fingerprint.webgl_spoof} onChange={(v) => { setHuman((h) => { const next = { ...h, fingerprint: { ...h.fingerprint, webgl_spoof: v } }; humanRef.current = next; saveNow(next, imageRef.current, mediaRef.current); return next; }); }} />
          <HeToggle label="AudioContext 노이즈" hint="오디오 핑거프린트에 미세 노이즈를 넣어 기기 식별을 어렵게 합니다." value={human.fingerprint.audio_noise} onChange={(v) => { setHuman((h) => { const next = { ...h, fingerprint: { ...h.fingerprint, audio_noise: v } }; humanRef.current = next; saveNow(next, imageRef.current, mediaRef.current); return next; }); }} />
          <HeToggle label="마우스 베지어 이동" hint="직선이 아닌 곡선 경로로 마우스를 움직여 사람처럼 보이게 합니다." value={human.fingerprint.mouse_bezier} onChange={(v) => { setHuman((h) => { const next = { ...h, fingerprint: { ...h.fingerprint, mouse_bezier: v } }; humanRef.current = next; saveNow(next, imageRef.current, mediaRef.current); return next; }); }} />
          <div className="he-field">
            <div className="he-tw">
              <span className="he-tw-label">클릭 좌표 오차</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={human.fingerprint.click_jitter_px}
                  onChange={(e) => {
                    const v = Math.round(parseFloat(e.target.value));
                    setHuman((h) => {
                      const next = { ...h, fingerprint: { ...h.fingerprint, click_jitter_px: v } };
                      humanRef.current = next;
                      return next;
                    });
                    scheduleSave();
                  }}
                  className="he-range-sm"
                />
                <span className="he-jitter-val">±{human.fingerprint.click_jitter_px}px</span>
              </div>
            </div>
            <p className="he-field-hint">버튼 정중앙이 아닌 ±Npx 범위에서 클릭합니다.</p>
          </div>
          <HeToggle label="캡cha 감지 → Telegram 알림" hint="CAPTCHA가 뜨면 Telegram으로 운영자에게 알립니다." value={human.fingerprint.captcha_telegram ?? true} onChange={(v) => { setHuman((h) => { const next = { ...h, fingerprint: { ...h.fingerprint, captcha_telegram: v } }; humanRef.current = next; saveNow(next, imageRef.current, mediaRef.current); return next; }); }} />
          <HeToggle
            label="CAPTCHA Vision 자동 해결 (Sonnet)"
            hint="AI로 CAPTCHA를 자동 시도합니다. 3회 실패 시 Telegram 알림 후 VNC 수동 처리로 넘깁니다."
            value={human.fingerprint.captcha_vision_auto ?? false}
            onChange={(v) => {
              setHuman((h) => {
                const next = { ...h, fingerprint: { ...h.fingerprint, captcha_vision_auto: v } };
                humanRef.current = next;
                saveNow(next, imageRef.current, mediaRef.current);
                return next;
              });
            }}
          />

        </div>

        <div className="panel he-panel">
          <div className="he-panel-t">■ 이미지 고유화</div>
          <HeSliderRow
            label="픽셀 노이즈 강도"
            hint="업로드 이미지에 눈에 띄지 않는 노이즈를 추가해 동일 파일 재사용 흔적을 줄입니다."
            value={image.noise_pct}
            min={0}
            max={5}
            step={0.1}
            suffix="%"
            onChange={(v) => { setImage((img) => { const next = { ...img, noise_pct: v }; imageRef.current = next; return next; }); scheduleSave(); }}
          />
          <HeStaticRow label="노이즈 방식" value="가우시안 · 슬라이더 % = 실제 강도" hint="위 강도 값이 실제 픽셀 변형 비율과 1:1로 적용됩니다." />
          <HeToggle label="EXIF 기기 정보 랜덤화" hint="카메라·기기 EXIF를 매번 다르게 넣어 같은 기기로 찍은 것처럼 보이지 않게 합니다." value={image.exif_randomize} onChange={(v) => { setImage((img) => { const next = { ...img, exif_randomize: v }; imageRef.current = next; saveNow(humanRef.current, next, mediaRef.current); return next; }); }} />
          <HeToggle label="EXIF GPS 랜덤 주입" hint="GPS 좌표를 무작위로 넣어 항상 같은 위치에서 촬영한 패턴을 방지합니다." value={image.gps_randomize} onChange={(v) => { setImage((img) => { const next = { ...img, gps_randomize: v }; imageRef.current = next; saveNow(humanRef.current, next, mediaRef.current); return next; }); }} />
          <HeStaticRow label="JPEG 품질 범위" value="90~96%" hint="매 업로드마다 90~96% 사이에서 품질을 랜덤 선택합니다." />
          <HeToggle label="중복 이미지 차단" hint="이미 사용한 이미지 해시는 다시 업로드하지 않습니다." value={image.block_duplicate} onChange={(v) => { setImage((img) => { const next = { ...img, block_duplicate: v }; imageRef.current = next; saveNow(humanRef.current, next, mediaRef.current); return next; }); }} />
          <HeStaticRow label="기본 이미지 모델" value={HUMAN_ENGINE_IMAGE_LABEL} hint="포스팅 큐에서 Imagen 모델을 설정합니다." />
          <HeStaticRow label="영상 해상도" value={`${FIXED_VIDEO_DIMENSIONS} · ${FIXED_VIDEO_RESOLUTION} 고정`} hint="Shorts·릴스 업로드용 9:16 세로 해상도입니다." />
          <HeToggle
            label="자막 자동 싱크 (Whisper)"
            hint="영상 생성 후 Whisper로 음성·자막 타이밍을 맞춥니다."
            value={media.whisper_subtitle_sync}
            onChange={(v) => { setMedia((m) => { const next = { ...m, whisper_subtitle_sync: v }; mediaRef.current = next; saveNow(humanRef.current, imageRef.current, next); return next; }); }}
          />
        </div>
      </div>
    </div>
  );
}
