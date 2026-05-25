import { higgsfieldRequest } from './client.js';
import { resolveVideoApiModel } from './model-map.js';

export type VideoModel =
  | 'seedance-2.0'
  | 'kling-3.0'
  | 'kling-3.0-motion-control'
  | 'kling-o1-edit'
  | 'sora-2'
  | 'veo-3.1-lite'
  | 'veo-3.1'
  | 'happyhorse'
  | 'grok-imagine-video'
  | 'wan-2.7'
  | 'minimax-hailuo-2.3'
  | 'seedance-1.5-pro'
  | 'higgsfield-dop';

export async function generateVideo(params: {
  imageUrl: string;
  prompt: string;
  model?: VideoModel | string;
  durationSec?: number;
}): Promise<string> {
  const uiModel = params.model || 'kling-3.0';
  const model = resolveVideoApiModel(uiModel);
  const args: Record<string, unknown> = {
    start_image_url: params.imageUrl,
    prompt: params.prompt,
    duration: params.durationSec || 15,
    aspect_ratio: '9:16',
    resolution: '720p',
  };
  if (uiModel === 'kling-3.0-motion-control') args.motion_control = true;
  if (uiModel === 'veo-3.1') args.model = 'veo-3-1-preview';
  if (uiModel === 'minimax-hailuo-2.3') args.model = 'minimax-2.3';

  const result = await higgsfieldRequest(model, args);
  return result.video_url as string;
}
