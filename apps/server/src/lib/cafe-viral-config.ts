import { getSetting } from './settings.js';
import { supabase } from '../middleware/auth.js';

export const CAFE_VIRAL_TARGET_WORKSPACE = 'yeonun' as const;

export interface ActivityRatio {
  daily_reply: number;
  self_qa: number;
}

export interface CafeViralConfig {
  enabled: boolean;
  target_workspace: typeof CAFE_VIRAL_TARGET_WORKSPACE;
  note?: string;
  keywords_yeonun: string[];
  post_style: string;
  reply_style: string;
  self_qa_enabled: boolean;
  self_qa_delay_min: number;
  mention_rate: number;
  daily_limit_per_cafe: number;
  daily_limit_total: number;
  activity_ratio: ActivityRatio;
  min_post_age_hours: number;
  max_post_age_days: number;
}

const DEFAULT_ACTIVITY_RATIO: ActivityRatio = { daily_reply: 8, self_qa: 2 };

const DEFAULT: CafeViralConfig = {
  enabled: true,
  target_workspace: CAFE_VIRAL_TARGET_WORKSPACE,
  note: '카페 침투는 연운 전용. 퀴즈·파나나는 카페 바이럴 미적용.',
  keywords_yeonun: ['신점추천', '사주봐줘', '운세추천', '사주어플', '신점어플', '궁합봐주세요', '오늘운세'],
  post_style: '고민·경험담 질문형 (서비스명 직접 언급 금지)',
  reply_style: '경험담 공감형',
  self_qa_enabled: true,
  self_qa_delay_min: 60,
  mention_rate: 0,
  daily_limit_per_cafe: 3,
  daily_limit_total: 10,
  activity_ratio: DEFAULT_ACTIVITY_RATIO,
  min_post_age_hours: 1,
  max_post_age_days: 7,
};

export function assertCafeViralYeonunWorkspace(workspace: string): void {
  if (workspace !== CAFE_VIRAL_TARGET_WORKSPACE) {
    throw new Error('카페 바이럴은 연운(yeonun) 전용입니다 (규칙 ㉛)');
  }
}

export function resolveActivityRatio(
  cafeRatio?: ActivityRatio | null,
  globalRatio?: ActivityRatio,
): ActivityRatio {
  const base = globalRatio ?? DEFAULT_ACTIVITY_RATIO;
  if (!cafeRatio) return base;
  return {
    daily_reply: cafeRatio.daily_reply ?? base.daily_reply,
    self_qa: cafeRatio.self_qa ?? base.self_qa,
  };
}

export async function getCafeViralConfig(): Promise<CafeViralConfig> {
  const raw = await getSetting<Partial<CafeViralConfig>>('cafe_viral', DEFAULT);
  return {
    ...DEFAULT,
    ...raw,
    target_workspace: CAFE_VIRAL_TARGET_WORKSPACE,
    keywords_yeonun: raw.keywords_yeonun ?? DEFAULT.keywords_yeonun,
  };
}

export function keywordsForWorkspace(config: CafeViralConfig, workspace: string): string[] {
  assertCafeViralYeonunWorkspace(workspace);
  return config.keywords_yeonun;
}

function kstTodayStart(): string {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  kst.setHours(0, 0, 0, 0);
  const utc = new Date(kst.getTime() - 9 * 60 * 60 * 1000);
  return utc.toISOString();
}

/** v3.18 ㉛ — 카페당 3 / 전체 10 */
export async function assertCafeViralReplyLimits(cafeId: string): Promise<void> {
  const config = await getCafeViralConfig();
  const since = kstTodayStart();

  const { count: totalToday } = await supabase
    .from('huma_cafe_viral_posts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'posted')
    .gte('posted_at', since);

  if ((totalToday ?? 0) >= config.daily_limit_total) {
    throw new Error(`카페 바이럴 일일 전체 한도 초과 (${config.daily_limit_total}건)`);
  }

  const { count: cafeToday } = await supabase
    .from('huma_cafe_viral_posts')
    .select('*', { count: 'exact', head: true })
    .eq('cafe_id', cafeId)
    .eq('status', 'posted')
    .gte('posted_at', since);

  if ((cafeToday ?? 0) >= config.daily_limit_per_cafe) {
    throw new Error(`카페당 일일 바이럴 한도 초과 (${config.daily_limit_per_cafe}건)`);
  }
}

/** v3.18 ㉜ — 워밍업·등업 완료 계정만 */
export async function assertCafeWarmupComplete(accountId: string, cafeId: string): Promise<void> {
  const { data } = await supabase
    .from('huma_cafe_warmup_accounts')
    .select('is_graded_up, status')
    .eq('account_id', accountId)
    .eq('cafe_id', cafeId)
    .maybeSingle();

  if (!data?.is_graded_up && data?.status !== 'active') {
    throw new Error('카페 등업 워밍업 미완료 계정 — 바이럴 답글 불가');
  }
}

export function normalizeCafePostUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (!u.hostname.includes('cafe.naver.com')) return raw;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
      return `https://cafe.naver.com/${parts[0]}/${parts[1]}`;
    }
    return raw.split('?')[0];
  } catch {
    return raw.split('?')[0];
  }
}
