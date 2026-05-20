import { higgsfieldRequest } from './client.js';

export type VideoModel =
  | 'kling-3.0'
  | 'seedance-2.0-fast'
  | 'seedance-2.0'
  | 'veo-3.1-fast'
  | 'veo-3.1'
  | 'higgsfield-dop';

export async function generateVideo(params: {
  imageUrl: string;
  prompt: string;
  model?: VideoModel;
  durationSec?: number;
}): Promise<string> {
  const model = params.model || 'kling-3.0';
  const result = await higgsfieldRequest(model, {
    start_image_url: params.imageUrl,
    prompt: params.prompt,
    duration: params.durationSec || 5,
    aspect_ratio: '9:16',
  });
  return result.video_url as string;
}
