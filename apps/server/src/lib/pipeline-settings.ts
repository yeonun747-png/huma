import { getSetting } from './settings.js';

function resolveVideoModel(raw: string, workspace: string): string {
  if (raw === 'kling-v3-turbo-text-to-video') return raw;
  const legacy = ['seedance-2.0', 'kling-3.0'];
  if (legacy.includes(raw)) return 'kling-v3-turbo-text-to-video';
  if (workspace === 'yeonun' || workspace === 'panana') return 'kling-v3-turbo-text-to-video';
  return 'kling-v3-turbo-text-to-video';
}

/** v3.27 — 영상 파이프라인 UI 전역 모델 설정 (higgsfield 키) */
export async function getPipelineModelSettings(workspace: string) {
  const hg = await getSetting<Record<string, unknown>>('higgsfield', {});
  const rawImg = String(hg.default_image_model ?? 'auto');
  const imageModel = rawImg === 'auto' ? undefined : rawImg;
  const videoModel = resolveVideoModel(String(hg.default_video_model ?? 'kling-v3-turbo-text-to-video'), workspace);
  const durationSec = Number(hg.video_duration_sec) > 0 ? Number(hg.video_duration_sec) : 15;
  const rawQuality = String(hg.video_quality ?? hg.default_video_resolution ?? '720p');
  const videoQuality = rawQuality === '1080p' ? ('1080p' as const) : ('720p' as const);
  return { imageModel, videoModel, durationSec, videoQuality };
}
