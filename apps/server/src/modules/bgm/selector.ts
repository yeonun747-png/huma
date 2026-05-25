import { askClaude } from '../../lib/anthropic-client.js';
import { normalizeBgmCategory, selectRandomBgmFile, type BgmCategory } from './pixabay.js';

const BGM_MOODS: BgmCategory[] = [
  'upbeat',
  'calm',
  'mysterious',
  'emotional',
  'energetic',
  'cinematic',
  'lofi',
];

export async function selectBgm(params: {
  workspace: string;
  contentMood: string;
  videoDurationSec: number;
  platform: string;
}): Promise<string | null> {
  void params.workspace;
  void params.videoDurationSec;
  void params.platform;

  const category = normalizeBgmCategory(params.contentMood);
  return selectRandomBgmFile(category);
}

export async function analyzeContentMood(text: string, workspace: string): Promise<BgmCategory> {
  void workspace;
  if (!process.env.ANTHROPIC_API_KEY) return 'calm';

  try {
    const reply = await askClaude(
      `스크립트의 BGM 분류를 분석해서 1개만 JSON으로 답해. category는 upbeat/calm/mysterious/emotional/energetic/cinematic/lofi 중 하나.\n스크립트: ${text.slice(0, 300)}\n{"category":""}`
    );
    if (reply) {
      const parsed = JSON.parse(reply) as { category?: string; mood?: string };
      return normalizeBgmCategory(parsed.category ?? parsed.mood ?? 'calm');
    }
  } catch {
    // ignore
  }

  return BGM_MOODS[Math.floor(Math.random() * BGM_MOODS.length)] ?? 'calm';
}
