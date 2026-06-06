/** 네이버 블로그 본문 목표 분량 — 600~700 / 700~800 / 900~1000자 중 랜덤 */

export type BlogPostLengthTier = 700 | 800 | 1000;

export type BlogPostLengthRange = {
  tier: BlogPostLengthTier;
  min: number;
  max: number;
};

export const BLOG_LENGTH_BY_TIER: Record<BlogPostLengthTier, { min: number; max: number }> = {
  700: { min: 600, max: 700 },
  800: { min: 700, max: 800 },
  1000: { min: 900, max: 1000 },
};

/** @deprecated tier 키 — BlogPostLengthTier 와 동일 */
export type BlogPostLengthTarget = BlogPostLengthTier;

export const BLOG_POST_LENGTH_OPTIONS = [700, 800, 1000] as const satisfies readonly BlogPostLengthTier[];

/** KST 기준 주말(토·일) */
export function isKstWeekend(now = new Date()): boolean {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
  }).format(now);
  return wd === 'Sat' || wd === 'Sun';
}

/** 평일: 800·1000 비중 ↑ / 주말: 700(600~700) 비중 ↑ */
const WEEKDAY_WEIGHTS: Record<BlogPostLengthTier, number> = {
  700: 12,
  800: 38,
  1000: 50,
};

const WEEKEND_WEIGHTS: Record<BlogPostLengthTier, number> = {
  700: 52,
  800: 28,
  1000: 20,
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
  const { min, max } = BLOG_LENGTH_BY_TIER[1000];
  return { tier: 1000, min, max };
}

/** @deprecated pickBlogPostLengthRange 사용 */
export function pickBlogPostTargetChars(now = new Date()): BlogPostLengthTier {
  return pickBlogPostLengthRange(now).tier;
}

export function blogPostLengthPromptGuide(range: BlogPostLengthRange): string {
  const { min, max, tier } = range;
  if (tier === 700) {
    return `[오늘 글 분량] ${min}~${max}자 (필수·완결·중간 끊김 금지). 쓰기 귀찮은 날처럼 짧고 간결하게 — 군더더기 없이 핵심만.`;
  }
  if (tier === 800) {
    return `[오늘 글 분량] ${min}~${max}자 (필수·완결·중간 끊김 금지). 보통 분량의 경험담.`;
  }
  return `[오늘 글 분량] ${min}~${max}자 (필수·완결·중간 끊김 금지). 평소보다 풍부하게 — 감정·에피소드를 충분히.`;
}
