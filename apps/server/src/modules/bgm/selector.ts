import axios from 'axios';
import { supabase } from '../../middleware/auth.js';
import { getSetting } from '../../lib/settings.js';
import { generateSunoMusic } from './suno.js';
import { createAnthropicClient } from '../../lib/anthropic-client.js';

export async function selectBgm(params: {
  workspace: string;
  contentMood: string;
  videoDurationSec: number;
  platform: string;
}): Promise<string> {
  let url = await queryBgm(params, ['mood', 'workspace', 'platform']);
  if (url) return url;

  url = await queryBgm(params, ['mood', 'workspace']);
  if (url) return url;

  url = await queryBgm(params, ['workspace']);
  if (url) return url;

  const bgmConfig = await getSetting('bgm', { fallback_to_suno: true });
  if (bgmConfig.fallback_to_suno) {
    return generateSunoMusic(params);
  }

  throw new Error('BGM 선택 실패');
}

async function queryBgm(
  params: { workspace: string; contentMood: string; videoDurationSec: number; platform: string },
  filters: string[]
): Promise<string | null> {
  let query = supabase
    .from('huma_bgm_library')
    .select('id, file_url, use_count')
    .gte('duration_sec', params.videoDurationSec)
    .order('use_count', { ascending: true })
    .limit(5);

  if (filters.includes('mood')) query = query.contains('mood', [params.contentMood]);
  if (filters.includes('workspace')) query = query.contains('workspace_fit', [params.workspace]);
  if (filters.includes('platform')) query = query.contains('platform_fit', [params.platform]);

  const { data } = await query;
  if (!data?.length) return null;

  const selected = data[Math.floor(Math.random() * data.length)];
  await supabase
    .from('huma_bgm_library')
    .update({ use_count: (selected.use_count ?? 0) + 1 })
    .eq('id', selected.id);

  return selected.file_url;
}

export async function analyzeContentMood(text: string, workspace: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return 'calm';
  try {
    const client = createAnthropicClient();
    if (!client) return 'calm';
    const res = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `스크립트의 무드를 분석해서 1개만 JSON으로 답해. mood는 calm/romantic/mysterious/energetic/inspiring/dark/playful/emotional/dramatic 중 하나. workspace: ${workspace}\n스크립트: ${text.slice(0, 300)}\n{"mood":""}`,
      }],
    });
    const block = res.content[0];
    if (block.type === 'text') return JSON.parse(block.text).mood ?? 'calm';
  } catch {
    // ignore
  }
  return 'calm';
}
