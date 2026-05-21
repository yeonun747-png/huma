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
  { id: 'seedance-2.0', label: 'Seedance 2.0', emoji: '🌟', sub: '최첨단 영상 모델', credits: 25, badge: 'TOP' as const },
  { id: 'kling-3.0', label: 'Kling 3.0', emoji: '🎥', sub: '시네마틱+오디오', credits: 7 },
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

export const DEFAULT_IMAGE_MODEL: ImageModelId = 'nano-banana-pro';
export const DEFAULT_VIDEO_MODEL: VideoModelId = 'kling-3.0';

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
