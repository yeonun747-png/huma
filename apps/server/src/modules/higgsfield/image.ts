import { higgsfieldRequest } from './client.js';

export type ImageModel =
  | 'nano-banana-pro'
  | 'nano-banana-2'
  | 'gpt-image-2'
  | 'seedream-5-lite'
  | 'higgsfield-soul-2'
  | 'higgsfield-soul-cinema'
  | 'flux2-max'
  | 'kling-o1';

export function selectImageModel(purpose: string): ImageModel {
  const map: Record<string, ImageModel> = {
    캐릭터_일관성: 'nano-banana-pro',
    텍스트_포함: 'gpt-image-2',
    패션_인물: 'higgsfield-soul-2',
    시네마틱: 'higgsfield-soul-cinema',
    대량_빠름: 'seedream-5-lite',
    '4K_고품질': 'flux2-max',
  };
  return map[purpose] || 'nano-banana-pro';
}

export async function generateImage(params: {
  prompt: string;
  model?: ImageModel;
  aspectRatio?: string;
  resolution?: '1K' | '2K' | '4K';
}): Promise<string> {
  const model = params.model || 'nano-banana-pro';
  const result = await higgsfieldRequest(model, {
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio || '9:16',
    resolution: params.resolution || '1K',
  });
  const images = result.images as Array<{ url: string }>;
  return images[0].url;
}
