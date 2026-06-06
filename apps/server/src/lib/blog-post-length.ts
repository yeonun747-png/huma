/** 네이버 블로그 본문 목표 분량 — 500 / 700 / 900자 중 랜덤 */

export const BLOG_POST_LENGTH_OPTIONS = [500, 700, 900] as const;
export type BlogPostLengthTarget = (typeof BLOG_POST_LENGTH_OPTIONS)[number];

/** KST 기준 주말(토·일) */
export function isKstWeekend(now = new Date()): boolean {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
  }).format(now);
  return wd === 'Sat' || wd === 'Sun';
}

/** 평일: 700·900 비중 ↑ / 주말: 500 비중 ↑ */
const WEEKDAY_WEIGHTS: Record<BlogPostLengthTarget, number> = {
  500: 12,
  700: 38,
  900: 50,
};

const WEEKEND_WEIGHTS: Record<BlogPostLengthTarget, number> = {
  500: 52,
  700: 28,
  900: 20,
};

export function pickBlogPostTargetChars(now = new Date()): BlogPostLengthTarget {
  const weights = isKstWeekend(now) ? WEEKEND_WEIGHTS : WEEKDAY_WEIGHTS;
  const total = BLOG_POST_LENGTH_OPTIONS.reduce((sum, n) => sum + weights[n], 0);
  let roll = Math.random() * total;
  for (const len of BLOG_POST_LENGTH_OPTIONS) {
    roll -= weights[len];
    if (roll <= 0) return len;
  }
  return 900;
}

export function blogPostLengthPromptGuide(target: BlogPostLengthTarget): string {
  if (target === 500) {
    return `[오늘 글 분량] 약 ${target}자 이내 (필수·완결·중간 끊김 금지). 쓰기 귀찮은 날처럼 짧고 간결하게 — 군더더기 없이 핵심만.`;
  }
  if (target === 700) {
    return `[오늘 글 분량] 약 ${target}자 이내 (필수·완결·중간 끊김 금지). 보통 분량의 경험담.`;
  }
  return `[오늘 글 분량] 약 ${target}자 이내 (필수·완결·중간 끊김 금지). 평소보다 풍부하게 — 감정·에피소드를 충분히.`;
}
