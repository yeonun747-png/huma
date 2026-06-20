/** Higgsfield Plus — 이미지 생성 모델 (cloud.higgsfield.ai UI 기준) */
export const IMAGE_MODELS = [
  { id: 'higgsfield-soul-2', label: 'Higgsfield Soul 2.0', emoji: '✨', sub: '초실사 패션·인물 비주얼', credits: 7, badge: 'NEW' as const },
  { id: 'higgsfield-soul-cinema', label: 'Higgsfield Soul Cinema', emoji: '🎬', sub: '시네마틱 필름 그레이드', credits: 8, badge: 'NEW' as const },
  { id: 'higgsfield-popcorn', label: 'Higgsfield Popcorn', emoji: '🍿', sub: '스토리보드·편집·생성', credits: 10 },
  { id: 'gpt-image-2', label: 'GPT Image 2', emoji: '🤖', sub: '4K · 텍스트 렌더링', credits: 8, badge: 'NEW' as const },
  { id: 'nano-banana-2', label: 'Nano Banana 2', emoji: '🍌', sub: 'Flash 속도 · Pro 품질', credits: 5 },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro', emoji: '🍌', sub: '최고 4K 이미지 모델', credits: 7, badge: 'TOP' as const },
  { id: 'seedream-5-lite', label: 'Seedream 5.0 lite', emoji: '🌱', sub: '지능형 비주얼 추론', credits: 4 },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5', emoji: '🎨', sub: '정확한 색감 렌더링', credits: 7 },
  { id: 'grok-imagine', label: 'Grok Imagine', emoji: '🛰', sub: 'xAI · 다양한 이미지 스타일', credits: 6 },
  { id: 'flux2', label: 'FLUX.2', emoji: '🔥', sub: '속도 최적화 디테일', credits: 8 },
  { id: 'reve', label: 'Reve', emoji: '🖼', sub: '고급 이미지 편집', credits: 7 },
  { id: 'z-image', label: 'Z-Image', emoji: '👤', sub: '즉시 생생한 인물 초상', credits: 5 },
  { id: 'topaz', label: 'Topaz', emoji: '🔍', sub: '고해상도 업스케일', credits: 4 },
] as const;

/** 영상 파이프라인 — EvoLink Kling 3.0 Turbo (유일) */
export const EVOLINK_VIDEO_MODEL_ID = 'kling-v3-turbo-text-to-video' as const;
export const EVOLINK_VIDEO_PRICE_PER_SEC_USD = 0.106;
export const EVOLINK_VIDEO_1080P_MULTIPLIER = 1.25;
export const PIPELINE_VIDEO_DURATION_MIN_SEC = 11;
export const PIPELINE_VIDEO_DURATION_MAX_SEC = 15;
export const PIPELINE_VIDEO_DURATION_OPTIONS = [
  11, 12, 13, 14, 15,
] as const;
export type PipelineVideoDuration = (typeof PIPELINE_VIDEO_DURATION_OPTIONS)[number];
export type PipelineVideoQuality = '720p' | '1080p';

/** 영상 파이프라인 ② — EvoLink Kling 3.0 Turbo 화질 옵션 */
export const PIPELINE_VIDEO_QUALITY_OPTIONS = [
  {
    quality: '720p' as const,
    label: 'Kling 3.0 Turbo — 720p — $0.106/초',
    pricePerSecUsd: EVOLINK_VIDEO_PRICE_PER_SEC_USD,
  },
  {
    quality: '1080p' as const,
    label: 'Kling 3.0 Turbo — 1080p — $0.133/초 (720p × 1.25)',
    pricePerSecUsd: EVOLINK_VIDEO_PRICE_PER_SEC_USD * EVOLINK_VIDEO_1080P_MULTIPLIER,
  },
] as const;

export const DEFAULT_PIPELINE_VIDEO_QUALITY: PipelineVideoQuality = '720p';

/** 레거시 UI 목록 — 파이프라인 영상 모델은 EvoLink 1종만 사용 */
export const VIDEO_MODELS = [
  {
    id: EVOLINK_VIDEO_MODEL_ID,
    label: 'Kling 3.0 Turbo',
    emoji: '🎥',
    sub: 'EvoLink API · 멀티샷',
  },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]['id'];
export type VideoModelId = (typeof VIDEO_MODELS)[number]['id'];

/** 레거시 Higgsfield UI ID — v3.26 실제 생성은 Imagen 4 */
export const DEFAULT_IMAGE_MODEL: ImageModelId = 'gpt-image-2';
export const DEFAULT_IMAGEN_MODEL = 'imagen-4.0-fast-generate-001';
export const DEFAULT_VIDEO_MODEL: VideoModelId = EVOLINK_VIDEO_MODEL_ID;

/** v3.26+ 영상 파이프라인 — Google Imagen 4 (Haiku가 Fast/Standard 자동 선택) */
export const PIPELINE_IMAGE_STEP_LABEL = 'Imagen 4 Fast/Standard (자동)';
export const HUMAN_ENGINE_IMAGE_LABEL = 'Haiku 자동 (Fast/Std)';

export type ImagenPipelineChoice =
  | 'auto'
  | 'imagen-4.0-fast-generate-001'
  | 'imagen-4.0-generate-001';

export const IMAGEN_PIPELINE_OPTIONS: ReadonlyArray<{ id: ImagenPipelineChoice; label: string }> = [
  { id: 'auto', label: '🤖 Haiku 자동 선택 — 텍스트→Standard, 일반→Fast' },
  { id: 'imagen-4.0-fast-generate-001', label: '⚡ Imagen 4 Fast — $0.02/장 · 블로그 대량 자동' },
  { id: 'imagen-4.0-generate-001', label: '✨ Imagen 4 Standard — $0.04/장 · 텍스트·배너 고화질' },
];

export type PipelineVideoAudioFamily = 'evolink';

/** 영상 파이프라인 ② — EvoLink Kling 3.0 Turbo */
export const PIPELINE_VIDEO_OPTIONS = [
  {
    selectValue: EVOLINK_VIDEO_MODEL_ID,
    id: EVOLINK_VIDEO_MODEL_ID,
    displayName: 'Kling 3.0 Turbo',
    label: 'Kling 3.0 Turbo — $0.106/초(720p)·멀티샷 지원',
    audioFamily: 'evolink' as PipelineVideoAudioFamily,
  },
] as const;

export const PIPELINE_VIDEO_HINT =
  '✓ EvoLink API · Kling 3.0 Turbo · 멀티샷 · 720p $0.106/초 · 1080p $0.133/초 · 음성 포함';

export function normalizePipelineVideoQuality(raw?: string | null): PipelineVideoQuality {
  return raw === '1080p' ? '1080p' : '720p';
}

export function normalizePipelineVideoDuration(raw?: number | null): PipelineVideoDuration {
  const n = Math.round(Number(raw) || PIPELINE_VIDEO_DURATION_MAX_SEC);
  if (n <= PIPELINE_VIDEO_DURATION_MIN_SEC) return PIPELINE_VIDEO_DURATION_MIN_SEC;
  if (n >= PIPELINE_VIDEO_DURATION_MAX_SEC) return PIPELINE_VIDEO_DURATION_MAX_SEC;
  return n as PipelineVideoDuration;
}

export function pipelineVideoPricePerSec(quality: PipelineVideoQuality): number {
  return quality === '1080p'
    ? EVOLINK_VIDEO_PRICE_PER_SEC_USD * EVOLINK_VIDEO_1080P_MULTIPLIER
    : EVOLINK_VIDEO_PRICE_PER_SEC_USD;
}

export function getPipelineVideoOption(selectValue: string) {
  return (
    PIPELINE_VIDEO_OPTIONS.find((o) => o.selectValue === selectValue) ??
    PIPELINE_VIDEO_OPTIONS[0]
  );
}

/** 진행 중 파이프라인 ② — 드롭다운 모델명과 동기 */
export function getPipelineVideoStepTitles(selectValue: string) {
  const name = getPipelineVideoOption(selectValue).displayName;
  return {
    titleDone: '영상 생성 완료',
    titleActive: `${name} 영상 생성 중…`,
    titleIdle: `${name} 영상 (오디오 포함)`,
  };
}

/** ② 영상 모델 → ③ 오디오 패널 */
export function getPipelineAudioCopy(_selectValue?: string) {
  return {
    title: 'Kling 3.0 Turbo 오디오',
    sub: '음성 비용이 영상 가격에 항상 포함됨, 별도 온/오프 옵션 없음 (대사·환경음 자동 생성)',
    hint: '✓ EvoLink API · 음성 별도 과금 없음',
    emoji: '🎵',
    runningLabel: 'Kling 3.0 Turbo 오디오',
  };
}

export function normalizePipelineVideoSelect(raw?: string | null): string {
  if (!raw) return EVOLINK_VIDEO_MODEL_ID;
  if (raw === EVOLINK_VIDEO_MODEL_ID) return EVOLINK_VIDEO_MODEL_ID;
  return EVOLINK_VIDEO_MODEL_ID;
}

export function pipelineVideoFromSelect(selectValue: string): VideoModelId {
  const hit = PIPELINE_VIDEO_OPTIONS.find((o) => o.selectValue === selectValue);
  return hit?.id ?? DEFAULT_VIDEO_MODEL;
}

export function normalizeImagenPipelineChoice(raw?: string | null): ImagenPipelineChoice {
  if (raw === 'imagen-4.0-fast-generate-001' || raw === 'imagen-4.0-generate-001') return raw;
  return 'auto';
}

export function pipelineImageCost(choice: ImagenPipelineChoice) {
  if (choice === 'auto') {
    return { label: 'Haiku 자동', display: '$0.02~$0.04', minUsd: 0.02, maxUsd: 0.04 };
  }
  if (choice === 'imagen-4.0-fast-generate-001') {
    return { label: 'Imagen 4 Fast', display: '$0.02', minUsd: 0.02, maxUsd: 0.02 };
  }
  return { label: 'Imagen 4 Standard', display: '$0.04', minUsd: 0.04, maxUsd: 0.04 };
}

/** 진행 중 파이프라인 ① — ① 이미지 모델 선택과 동기 */
export function getPipelineImageStepTitles(choice: ImagenPipelineChoice) {
  const cost = pipelineImageCost(choice);
  const displayName =
    choice === 'auto' ? PIPELINE_IMAGE_STEP_LABEL : cost.label;
  return {
    titleDone: '이미지 생성 완료',
    titleActive: `${displayName} 생성 중…`,
    titleIdle: displayName,
    cost,
  };
}

export function resolvePipelineImageChoice(
  formChoice: ImagenPipelineChoice,
  haikuAuto: boolean,
  jobImageModel?: string | null,
): ImagenPipelineChoice {
  if (jobImageModel) return normalizeImagenPipelineChoice(jobImageModel);
  if (haikuAuto) return 'auto';
  return formChoice;
}

export function pipelineVideoCost(
  _modelId?: string,
  durationSec: number = 15,
  quality: PipelineVideoQuality = DEFAULT_PIPELINE_VIDEO_QUALITY,
) {
  const usd = durationSec * pipelineVideoPricePerSec(quality);
  return {
    usd,
    durationLabel: `${durationSec}초(${quality})`,
    usdDisplay: `$${usd.toFixed(2)}`,
    quality,
  };
}

export function pipelineTotalCostDisplay(
  img: ImagenPipelineChoice,
  videoModelId: string,
  durationSec: number = 15,
  quality: PipelineVideoQuality = '720p',
) {
  const imgCost = pipelineImageCost(img);
  const vid = pipelineVideoCost(videoModelId, durationSec, quality);
  const min = imgCost.minUsd + vid.usd;
  const max = imgCost.maxUsd + vid.usd;
  if (min === max) return `$${min.toFixed(2)}`;
  return `$${min.toFixed(2)}~$${max.toFixed(2)}`;
}

export function tableVideoModelLabel(
  videoModel?: string | null,
  durationSec?: number | null,
): string {
  const opt = getPipelineVideoOption(normalizePipelineVideoSelect(videoModel));
  const dur = Number(durationSec) > 0 ? Number(durationSec) : 15;
  return `${opt.displayName} ${dur}초`;
}

export function tableImageModelLabel(imageModel?: string | null): string {
  if (imageModel === 'imagen-4.0-generate-001') return 'imagen-4-std';
  if (imageModel === 'imagen-4.0-fast-generate-001') return 'imagen-4-fast';
  return 'imagen-4-auto';
}

export function estimateTodayPipelineCost(
  items: Array<{
    status: string;
    image_model?: string | null;
    video_model?: string | null;
    duration_sec?: number | null;
  }>,
  defaultDurationSec = 15,
) {
  let imageUsd = 0;
  let videoUsd = 0;
  let done = 0;
  for (const item of items) {
    if (item.status !== 'done') continue;
    done += 1;
    const img = normalizeImagenPipelineChoice(item.image_model);
    const imgC = pipelineImageCost(img);
    imageUsd += (imgC.minUsd + imgC.maxUsd) / 2;
    const dur = Number(item.duration_sec) > 0 ? Number(item.duration_sec) : defaultDurationSec;
    videoUsd += pipelineVideoCost(item.video_model ?? DEFAULT_VIDEO_MODEL, dur).usd;
  }
  const total = imageUsd + videoUsd;
  return {
    totalUsd: total,
    totalDisplay: total > 0 ? `$${total.toFixed(2)}` : '$0.00',
    subDisplay: done > 0 ? `영상 $${videoUsd.toFixed(2)} + 이미지 $${imageUsd.toFixed(2)}` : '완료 건 없음',
    done,
  };
}

const LEGACY_IMAGE: Record<string, ImageModelId> = {
  'flux2-max': 'flux2',
  'kling-o1': 'nano-banana-pro',
};

const LEGACY_VIDEO: Record<string, VideoModelId> = {
  'seedance-2.0': EVOLINK_VIDEO_MODEL_ID,
  'seedance-2.0-fast': EVOLINK_VIDEO_MODEL_ID,
  'kling-3.0': EVOLINK_VIDEO_MODEL_ID,
  'kling-3.0-motion-control': EVOLINK_VIDEO_MODEL_ID,
  'kling-2.6': EVOLINK_VIDEO_MODEL_ID,
  'veo-3.1-fast': EVOLINK_VIDEO_MODEL_ID,
  'kling-o1': EVOLINK_VIDEO_MODEL_ID,
};

export function normalizeImageModel(raw?: string | null): ImageModelId {
  const id = raw ? (LEGACY_IMAGE[raw] ?? raw) : DEFAULT_IMAGE_MODEL;
  if (IMAGE_MODELS.some((m) => m.id === id)) return id as ImageModelId;
  return DEFAULT_IMAGE_MODEL;
}

export function normalizeVideoModel(raw?: string | null): VideoModelId {
  const id = raw ? (LEGACY_VIDEO[raw] ?? raw) : DEFAULT_VIDEO_MODEL;
  if (VIDEO_MODELS.some((m) => m.id === id)) return id as VideoModelId;
  return DEFAULT_VIDEO_MODEL;
}

export function imageModelLabel(id: string): string {
  const m = IMAGE_MODELS.find((x) => x.id === id);
  return m ? `${m.emoji} ${m.label}` : id;
}

export function videoModelLabel(id: string): string {
  const m = VIDEO_MODELS.find((x) => x.id === id);
  return m ? `${m.emoji} ${m.label}` : id;
}

function badgePrefix(badge?: 'NEW' | 'TOP'): string {
  return badge ? `[${badge}] ` : '';
}

export function imageModelOptionLabel(m: (typeof IMAGE_MODELS)[number]): string {
  const badge = 'badge' in m ? m.badge : undefined;
  return `${m.emoji} ${m.label} — ${badgePrefix(badge)}${m.sub}`;
}

export function videoModelOptionLabel(m: (typeof VIDEO_MODELS)[number]): string {
  return `${m.emoji} ${m.label} — ${m.sub}`;
}
