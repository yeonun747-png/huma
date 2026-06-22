import { getSetting } from './settings.js';

export interface DaySchedule {
  yeonun_blog: number;
  /** @deprecated quizoasis_blog + panana_blog 합 — 하위 호환 */
  quizoasis_panana_blog: number;
  quizoasis_blog: number;
  panana_blog: number;
  total_blog: number;
  type_b_ratio: number;
  videos_per_day: number;
}

export interface PostingScheduleConfig {
  weekday: DaySchedule;
  weekend: DaySchedule;
  cafe: { daily: number; type: string; credit_cost: number };
  monthly_estimate: Record<string, unknown>;
}

const DEFAULT: PostingScheduleConfig = {
  weekday: {
    yeonun_blog: 6,
    quizoasis_panana_blog: 2,
    quizoasis_blog: 1,
    panana_blog: 1,
    total_blog: 8,
    type_b_ratio: 0.5,
    videos_per_day: 4,
  },
  weekend: {
    yeonun_blog: 3,
    quizoasis_panana_blog: 2,
    quizoasis_blog: 1,
    panana_blog: 1,
    total_blog: 5,
    type_b_ratio: 0.5,
    videos_per_day: 3,
  },
  cafe: { daily: 2, type: 'text_image_only', credit_cost: 0 },
  monthly_estimate: {
    weekday_days: 22,
    weekend_days: 8,
    total_videos: 112,
    total_credits: 1008,
    plan: 'Higgsfield Plus 1000 credits',
  },
};

export function isWeekendKst(date = new Date()): boolean {
  const kst = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  return day === 0 || day === 6;
}

export async function getPostingSchedule(): Promise<PostingScheduleConfig> {
  return getSetting('posting_schedule', DEFAULT);
}

export async function getDailyBlogQuota(): Promise<DaySchedule> {
  const schedule = await getPostingSchedule();
  const raw = isWeekendKst() ? schedule.weekend : schedule.weekday;
  return normalizeDaySchedule(raw);
}

function normalizeDaySchedule(raw: DaySchedule): DaySchedule {
  const quizoasis_blog = raw.quizoasis_blog ?? 1;
  const panana_blog = raw.panana_blog ?? 1;
  return {
    ...raw,
    quizoasis_blog,
    panana_blog,
    quizoasis_panana_blog: quizoasis_blog + panana_blog,
  };
}
