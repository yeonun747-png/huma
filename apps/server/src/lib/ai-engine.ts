import { getSetting } from './settings.js';

export interface AiEngineConfig {
  main_model: string;
  sub_model: string;
  main_tasks: string[];
  sub_tasks: string[];
  max_input_tokens: number;
  max_output_tokens: number;
}

const DEFAULT_AI_ENGINE: AiEngineConfig = {
  main_model: 'claude-sonnet-4-6',
  sub_model: 'claude-haiku-4-5-20251001',
  main_tasks: ['blog_post', 'social_caption', 'tts_script', 'video_prompt'],
  sub_tasks: ['hashtags', 'summary', 'autoDecide'],
  max_input_tokens: 8000,
  max_output_tokens: 4000,
};

export async function getAiEngineConfig(): Promise<AiEngineConfig> {
  return getSetting('ai_engine', DEFAULT_AI_ENGINE);
}

export async function getMainClaudeModel(): Promise<string> {
  return (await getAiEngineConfig()).main_model;
}

export async function getSubClaudeModel(): Promise<string> {
  return (await getAiEngineConfig()).sub_model;
}
