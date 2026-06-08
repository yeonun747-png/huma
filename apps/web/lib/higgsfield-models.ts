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

/** Higgsfield Plus — 영상 생성 모델 (UI 13종) */
export const VIDEO_MODELS = [
  { id: 'seedance-2.0', label: 'Seedance 2.0', emoji: '🌟', sub: '최첨단 영상 모델', credits: 75, badge: 'TOP' as const },
  { id: 'kling-3.0', label: 'Kling 3.0', emoji: '🎥', sub: '시네마틱+오디오', credits: 21 },
  { id: 'kling-3.0-motion-control', label: 'Kling 3.0 Motion Control', emoji: '🕺', sub: '영상→이미지 모션 전달', credits: 9, badge: 'NEW' as const },
  { id: 'kling-o1-edit', label: 'Kling o1 Edit', emoji: '✂️', sub: '고급 영상 편집', credits: 10 },
  { id: 'sora-2', label: 'Sora 2', emoji: '🌐', sub: 'OpenAI 최상위 영상', credits: 30 },
  { id: 'veo-3.1-lite', label: 'Google Veo 3.1 Lite', emoji: '🚀', sub: 'Google 빠른 생성', credits: 22, badge: 'NEW' as const },
  { id: 'veo-3.1', label: 'Google Veo 3.1', emoji: '💫', sub: '오디오 포함 고급 AI 영상', credits: 58 },
  { id: 'happyhorse', label: 'HappyHorse', emoji: '🐴', sub: 'Alibaba 1위 영상·오디오', credits: 20, badge: 'NEW' as const },
  { id: 'grok-imagine-video', label: 'Grok Imagine', emoji: '🛰', sub: '동기화 오디오 시네마틱', credits: 15 },
  { id: 'wan-2.7', label: 'Wan 2.7', emoji: '🌀', sub: '시작·끝 프레임 제어', credits: 12, badge: 'NEW' as const },
  { id: 'minimax-hailuo-2.3', label: 'Minimax Hailuo 2.3', emoji: '🌊', sub: '고속 고다이내믹', credits: 8 },
  { id: 'seedance-1.5-pro', label: 'Seedance 1.5 Pro', emoji: '🎬', sub: '프로 오디오·비주얼 싱크', credits: 18 },
  { id: 'higgsfield-dop', label: 'Higgsfield DOP', emoji: '🎞', sub: 'VFX · 카메라 제어', credits: 12 },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]['id'];
export type VideoModelId = (typeof VIDEO_MODELS)[number]['id'];

/** 레거시 Higgsfield UI ID — v3.26 실제 생성은 Imagen 4 */
export const DEFAULT_IMAGE_MODEL: ImageModelId = 'gpt-image-2';
export const DEFAULT_IMAGEN_MODEL = 'imagen-4.0-fast-generate-001';
export const DEFAULT_VIDEO_MODEL: VideoModelId = 'kling-3.0';

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

export type PipelineVideoAudioFamily = 'kling' | 'seedance' | 'builtin';

/** v3.26 목업 ② — Kling 3.0 / Seedance 2.0 Standard 만 */
export const PIPELINE_VIDEO_OPTIONS = [
  {
    selectValue: 'kling-3.0',
    id: 'kling-3.0' as VideoModelId,
    displayName: 'Kling 3.0',
    label: '🎥 Kling 3.0 — $1.05/15초 (21크레딧) · 시네마틱+내장오디오',
    videoUsd: 1.05,
    durationLabel: '15초',
    credits: 21,
    audioFamily: 'kling' as PipelineVideoAudioFamily,
  },
  {
    selectValue: 'seedance-2.0',
    id: 'seedance-2.0' as VideoModelId,
    displayName: 'Seedance 2.0 Standard',
    label: '🌟 Seedance 2.0 Standard — $3.75/15초 (75크레딧) · 최고화질+오디오',
    videoUsd: 3.75,
    durationLabel: '15초',
    credits: 75,
    audioFamily: 'seedance' as PipelineVideoAudioFamily,
  },
] as const;

export const PIPELINE_VIDEO_HINT =
  '✓ 두 모델 모두 Higgsfield Cloud API · 15초 기준 Kling $1.05 · Seedance $3.75 · 내장 오디오 자동 생성';

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
    titleIdle: `${name} 영상 (내장 오디오)`,
  };
}

/** ② 영상 모델 선택 → ③ 오디오 패널 문구 (목업 연동) */
export function getPipelineAudioCopy(selectValue: string) {
  const opt = getPipelineVideoOption(selectValue);
  if (opt.audioFamily === 'seedance') {
    return {
      title: 'Seedance 2.0 내장 오디오 자동 생성',
      sub: 'BGM · 효과음 · 주변음 — 영상과 동기화, 별도 TTS 불필요',
      hint: '✓ Seedance 2.0 · 15초 기준 내장 오디오 · Higgsfield Cloud API',
      emoji: '🎵',
      runningLabel: 'Seedance 2.0 내장 오디오',
    };
  }
  if (opt.audioFamily === 'kling') {
    return {
      title: 'Kling 3.0 내장 오디오 자동 생성',
      sub: 'BGM · 효과음 · 주변음 — 영상과 동기화, 별도 설정 불필요',
      hint: '✓ Kling 3.0 · 15초 · 21크레딧 · 시네마틱+내장오디오',
      emoji: '🎵',
      runningLabel: 'Kling 3.0 내장 오디오',
    };
  }
  return {
    title: `${pipelineVideoFromSelect(selectValue)} 내장 오디오 자동 생성`,
    sub: 'BGM · 효과음 — 영상 모델과 동기화',
    hint: '✓ TTS 불필요 — Higgsfield Cloud 내장 오디오',
    emoji: '🎵',
    runningLabel: '내장 오디오',
  };
}

export function normalizePipelineVideoSelect(raw?: string | null): string {
  if (raw === 'seedance-2.0' || raw === 'seedance-2.0-fast') return 'seedance-2.0';
  const v = raw ? (LEGACY_VIDEO[raw] ?? raw) : DEFAULT_VIDEO_MODEL;
  if (v === 'seedance-2.0') return 'seedance-2.0';
  const hit = PIPELINE_VIDEO_OPTIONS.find((o) => o.selectValue === v || o.id === v);
  return hit?.selectValue ?? 'kling-3.0';
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

export function pipelineVideoCost(modelId: string) {
  const normalized = normalizeVideoModel(modelId);
  const opt =
    PIPELINE_VIDEO_OPTIONS.find((o) => o.selectValue === modelId || o.id === normalized) ??
    PIPELINE_VIDEO_OPTIONS[0];
  return {
    usd: opt.videoUsd,
    durationLabel: opt.durationLabel,
  };
}

export function pipelineTotalCostDisplay(img: ImagenPipelineChoice, videoModelId: string) {
  const imgCost = pipelineImageCost(img);
  const vid = pipelineVideoCost(videoModelId);
  const min = imgCost.minUsd + vid.usd;
  const max = imgCost.maxUsd + vid.usd;
  if (min === max) return `$${min.toFixed(2)}`;
  return `$${min.toFixed(2)}~$${max.toFixed(2)}`;
}

export function tableImageModelLabel(imageModel?: string | null): string {
  if (imageModel === 'imagen-4.0-generate-001') return 'imagen-4-std';
  if (imageModel === 'imagen-4.0-fast-generate-001') return 'imagen-4-fast';
  return 'imagen-4-auto';
}

export function estimateTodayPipelineCost(items: Array<{ status: string; image_model?: string | null; video_model?: string | null }>) {
  let imageUsd = 0;
  let videoUsd = 0;
  let done = 0;
  for (const item of items) {
    if (item.status !== 'done') continue;
    done += 1;
    const img = normalizeImagenPipelineChoice(item.image_model);
    const imgC = pipelineImageCost(img);
    imageUsd += (imgC.minUsd + imgC.maxUsd) / 2;
    videoUsd += pipelineVideoCost(item.video_model ?? DEFAULT_VIDEO_MODEL).usd;
  }
  const total = imageUsd + videoUsd;
  return {
    totalUsd: total,
    totalDisplay: total > 0 ? `$${total.toFixed(2)}` : '$0.00',
    subDisplay: done > 0 ? `영상$${videoUsd.toFixed(2)} + 이미지$${imageUsd.toFixed(2)}` : '완료 건 없음',
    done,
  };
}

const LEGACY_IMAGE: Record<string, ImageModelId> = {
  'flux2-max': 'flux2',
  'kling-o1': 'nano-banana-pro',
};

const LEGACY_VIDEO: Record<string, VideoModelId> = {
  'seedance-2.0-fast': 'seedance-2.0',
  'veo-3.1-fast': 'veo-3.1-lite',
  'kling-o1': 'kling-o1-edit',
  'kling-2.6': 'kling-3.0',
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
  const badge = 'badge' in m ? m.badge : undefined;
  return `${m.emoji} ${m.label} — ${badgePrefix(badge)}${m.sub}`;
}
