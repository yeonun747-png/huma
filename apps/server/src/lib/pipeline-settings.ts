import { getSetting } from './settings.js';

function resolveVideoModel(raw: string, workspace: string): string {
  const allowed = ['seedance-2.0', 'kling-3.0'];
  if (allowed.includes(raw)) return raw;
  if (workspace === 'yeonun' || workspace === 'panana') return 'seedance-2.0';
  return 'kling-3.0';
}

/** v3.27 — 영상 파이프라인 UI 전역 모델 설정 (higgsfield 키) */
export async function getPipelineModelSettings(workspace: string) {
  const hg = await getSetting<Record<string, unknown>>('higgsfield', {});
  const rawImg = String(hg.default_image_model ?? 'auto');
  const imageModel = rawImg === 'auto' ? undefined : rawImg;
  const videoModel = resolveVideoModel(String(hg.default_video_model ?? 'kling-3.0'), workspace);
  const durationSec = Number(hg.video_duration_sec) > 0 ? Number(hg.video_duration_sec) : 15;
  return { imageModel, videoModel, durationSec };
}
