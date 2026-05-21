import { higgsfieldRequest } from './client.js';
import { resolveImageApiModel } from './model-map.js';

export type ImageModel =
  | 'higgsfield-soul-2'
  | 'higgsfield-soul-cinema'
  | 'higgsfield-popcorn'
  | 'gpt-image-2'
  | 'nano-banana-2'
  | 'nano-banana-pro'
  | 'seedream-5-lite'
  | 'gpt-image-1.5'
  | 'grok-imagine'
  | 'flux2'
  | 'reve'
  | 'z-image'
  | 'topaz';

export function selectImageModel(purpose: string): ImageModel {
  const map: Record<string, ImageModel> = {
    캐릭터_일관성: 'nano-banana-pro',
    텍스트_포함: 'gpt-image-2',
    패션_인물: 'higgsfield-soul-2',
    시네마틱: 'higgsfield-soul-cinema',
    대량_빠름: 'seedream-5-lite',
    '4K_고품질': 'flux2',
    업스케일: 'topaz',
    편집: 'reve',
  };
  return map[purpose] || 'nano-banana-pro';
}

export async function generateImage(params: {
  prompt: string;
  model?: ImageModel | string;
  aspectRatio?: string;
  resolution?: '1K' | '2K' | '4K';
}): Promise<string> {
  const uiModel = params.model || 'nano-banana-pro';
  const model = resolveImageApiModel(uiModel);
  const result = await higgsfieldRequest(model, {
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio || '9:16',
    resolution: params.resolution || '1K',
  });
  const images = result.images as Array<{ url: string }>;
  return images[0].url;
}
