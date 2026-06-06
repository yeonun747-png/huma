/** 네이버 블로그 본문 목표 분량 — 400~500 / 600~700 / 800~900자 중 랜덤 */

export type BlogPostLengthTier = 500 | 700 | 900;

export type BlogPostLengthRange = {
  tier: BlogPostLengthTier;
  min: number;
  max: number;
};

export const BLOG_LENGTH_BY_TIER: Record<BlogPostLengthTier, { min: number; max: number }> = {
  500: { min: 400, max: 500 },
  700: { min: 600, max: 700 },
  900: { min: 800, max: 900 },
};

/** @deprecated tier 키 — BlogPostLengthTier 와 동일 */
export type BlogPostLengthTarget = BlogPostLengthTier;

export const BLOG_POST_LENGTH_OPTIONS = [500, 700, 900] as const satisfies readonly BlogPostLengthTier[];

/** KST 기준 주말(토·일) */
export function isKstWeekend(now = new Date()): boolean {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
  }).format(now);
  return wd === 'Sat' || wd === 'Sun';
}

/** 평일: 700·900 비중 ↑ / 주말: 500(400~500) 비중 ↑ */
const WEEKDAY_WEIGHTS: Record<BlogPostLengthTier, number> = {
  500: 12,
  700: 38,
  900: 50,
};

const WEEKEND_WEIGHTS: Record<BlogPostLengthTier, number> = {
  500: 52,
  700: 28,
  900: 20,
};

export function pickBlogPostLengthRange(now = new Date()): BlogPostLengthRange {
  const weights = isKstWeekend(now) ? WEEKEND_WEIGHTS : WEEKDAY_WEIGHTS;
  const total = BLOG_POST_LENGTH_OPTIONS.reduce((sum, n) => sum + weights[n], 0);
  let roll = Math.random() * total;
  for (const tier of BLOG_POST_LENGTH_OPTIONS) {
    roll -= weights[tier];
    if (roll <= 0) {
      const { min, max } = BLOG_LENGTH_BY_TIER[tier];
      return { tier, min, max };
    }
  }
  const { min, max } = BLOG_LENGTH_BY_TIER[900];
  return { tier: 900, min, max };
}

/** @deprecated pickBlogPostLengthRange 사용 */
export function pickBlogPostTargetChars(now = new Date()): BlogPostLengthTier {
  return pickBlogPostLengthRange(now).tier;
}

export function blogPostLengthPromptGuide(range: BlogPostLengthRange): string {
  const { min, max, tier } = range;
  if (tier === 500) {
    return `[오늘 글 분량] ${min}~${max}자 (필수·완결·중간 끊김 금지). 쓰기 귀찮은 날처럼 짧고 간결하게 — 군더더기 없이 핵심만.`;
  }
  if (tier === 700) {
    return `[오늘 글 분량] ${min}~${max}자 (필수·완결·중간 끊김 금지). 보통 분량의 경험담.`;
  }
  return `[오늘 글 분량] ${min}~${max}자 (필수·완결·중간 끊김 금지). 평소보다 풍부하게 — 감정·에피소드를 충분히.`;
}
