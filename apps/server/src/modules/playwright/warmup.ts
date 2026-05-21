import { askClaudeWithModel } from '../../lib/anthropic-client.js';

export interface WarmupPlan {
  blogVisits: number;
  likes: number;
  comments: number;
}

const HAIKU = 'claude-haiku-4-5-20251001';

export async function getTodayPlan(account: {
  warmup_day?: number;
  health_score?: number;
}): Promise<WarmupPlan> {
  const d = account.warmup_day ?? 0;
  if (d < 7) return { blogVisits: 2, likes: 1, comments: 0 };
  if (d < 14) return { blogVisits: 5, likes: 3, comments: 0 };
  if (d < 30) return { blogVisits: 10, likes: 7, comments: 2 };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { blogVisits: 12, likes: 8, comments: 2 };
  }

  try {
    const raw = await askClaudeWithModel({
      model: HAIKU,
      max_tokens: 150,
      prompt: `건강점수:${account.health_score ?? 100}
활동계획JSON:{"blogVisits":1~15,"likes":숫자,"comments":숫자}
JSON만:`,
    });
    if (!raw) return { blogVisits: 12, likes: 8, comments: 2 };
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch?.[0] ?? raw) as WarmupPlan;
  } catch {
    return { blogVisits: 12, likes: 8, comments: 2 };
  }
}

export function maxCrankVisitsForWarmup(warmupDay: number): number {
  if (warmupDay < 7) return 2;
  return 15;
}

export function getCrankDailyLimit(warmupDay: number): number {
  if (warmupDay < 7) return 2;
  return 30;
}
