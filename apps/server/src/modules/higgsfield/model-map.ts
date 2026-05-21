/** UI/DB model id → Higgsfield cloud API model id */
const IMAGE_API: Record<string, string> = {
  'higgsfield-soul-2': 'text2image_soul_v2',
  'higgsfield-soul-cinema': 'soul_cinematic',
  'higgsfield-popcorn': 'higgsfield-popcorn',
  'gpt-image-2': 'gpt_image_2',
  'nano-banana-2': 'nano_banana_flash',
  'nano-banana-pro': 'nano_banana_2',
  'seedream-5-lite': 'seedream_v5_lite',
  'gpt-image-1.5': 'gpt-image-1.5',
  'grok-imagine': 'grok_image',
  flux2: 'flux_2',
  reve: 'reve',
  'z-image': 'z_image',
  topaz: 'topaz',
  'flux2-max': 'flux_2',
};

const VIDEO_API: Record<string, string> = {
  'seedance-2.0': 'seedance_2_0',
  'kling-3.0': 'kling3_0',
  'kling-3.0-motion-control': 'kling3_0',
  'kling-o1-edit': 'kling-omni-flf',
  'sora-2': 'open_sora_video',
  'veo-3.1-lite': 'veo3_1_lite',
  'veo-3.1': 'veo3_1',
  happyhorse: 'happyhorse',
  'grok-imagine-video': 'grok_video',
  'wan-2.7': 'wan2_7',
  'minimax-hailuo-2.3': 'minimax_hailuo',
  'seedance-1.5-pro': 'seedance1_5',
  'higgsfield-dop': 'cinematic_studio_video_v2',
  // legacy
  'seedance-2.0-fast': 'seedance_2_0',
  'veo-3.1-fast': 'veo3_1_lite',
  'kling-o1': 'kling-omni-flf',
  'kling-2.6': 'kling2_6',
};

const TTS_API: Record<string, string> = {
  'eleven-v3': 'eleven-v3',
  'minimax-speech-2.8': 'minimax-speech-2.8',
  'minimax-speech': 'minimax-speech-2.8',
  'seed-speech': 'seed-speech',
  'vibe-voice': 'vibe-voice',
};

export function resolveImageApiModel(id: string): string {
  return IMAGE_API[id] ?? id;
}

export function resolveVideoApiModel(id: string): string {
  return VIDEO_API[id] ?? id;
}

export function resolveTtsApiModel(id: string): string {
  return TTS_API[id] ?? id;
}
