import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';

export interface AccountPersona {
  age: number;
  job: string;
  activeHours: string;
  wpm: number;
  typoRate: number;
  visitDurationMin: number;
  likeProb: number;
  commentProb: number;
  interests: string[];
}

const HAIKU_FALLBACK = 'claude-haiku-4-5-20251001';

const DEFAULT_PERSONA: AccountPersona = {
  age: 32,
  job: '직장인',
  activeHours: 'evening',
  wpm: 52,
  typoRate: 0.04,
  visitDurationMin: 4,
  likeProb: 0.7,
  commentProb: 0.2,
  interests: ['사주', '운세', '꿈해몽'],
};

export async function generatePersona(workspace: string): Promise<AccountPersona> {
  if (!process.env.ANTHROPIC_API_KEY) return { ...DEFAULT_PERSONA, interests: workspaceInterests(workspace) };

  try {
    const raw = await askClaudeWithModel({
      model: (await getSubClaudeModel()) || HAIKU_FALLBACK,
      max_tokens: 200,
      prompt: `서비스 ${workspace} 네이버 블로그 사용자 페르소나 JSON:
{"age":25~55,"job":"직업","activeHours":"morning/afternoon/evening/night",
"wpm":35~75,"typoRate":0.02~0.08,"visitDurationMin":2~8,
"likeProb":0.3~0.9,"commentProb":0.1~0.4,
"interests":["관심사1","관심사2"]}
JSON만:`,
    });
    if (!raw) return { ...DEFAULT_PERSONA, interests: workspaceInterests(workspace) };
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as AccountPersona;
    return { ...DEFAULT_PERSONA, ...parsed, interests: parsed.interests?.length ? parsed.interests : workspaceInterests(workspace) };
  } catch {
    return { ...DEFAULT_PERSONA, interests: workspaceInterests(workspace) };
  }
}

function workspaceInterests(workspace: string): string[] {
  if (workspace === 'quizoasis') return ['심리테스트', 'MBTI', '성격'];
  if (workspace === 'panana') return ['AI캐릭터', '감성', '시네마'];
  return ['사주', '운세', '꿈해몽'];
}

export function parsePersona(raw: unknown): AccountPersona {
  if (!raw || typeof raw !== 'object') return DEFAULT_PERSONA;
  return { ...DEFAULT_PERSONA, ...(raw as AccountPersona) };
}
