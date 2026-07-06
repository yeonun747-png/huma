import { getSetting, updateSetting } from './settings.js';
import {
  CRANK_DEAD_ZONE_END,
  CRANK_DEAD_ZONE_START,
  isKstNightBan,
  msUntilNightBanEnd,
} from './crank-schedule-config.js';

const KEY = 'activity_control';

export interface ActivityControlState {
  crank_enabled: boolean;
  posting_enabled: boolean;
  /** KST 01~04시 C-Rank 전용 활동 금지 (포스팅 야간금지 23~08과 별도) */
  crank_dead_zone?: boolean;
}

let crankEnabled = true;
let postingEnabled = true;
let crankDeadZone = true;

export async function initActivityControl(): Promise<void> {
  const state = await getSetting<ActivityControlState>(KEY, {
    crank_enabled: true,
    posting_enabled: true,
    crank_dead_zone: true,
  });
  crankEnabled = state.crank_enabled !== false;
  postingEnabled = state.posting_enabled !== false;
  crankDeadZone = state.crank_dead_zone !== false;
}

export function getCrankDeadZoneEnabled(): boolean {
  return crankDeadZone;
}

export function getCrankEnabled(): boolean {
  return crankEnabled;
}

export function getPostingEnabled(): boolean {
  return postingEnabled;
}

export async function getActivityControlState(): Promise<ActivityControlState> {
  return {
    crank_enabled: crankEnabled,
    posting_enabled: postingEnabled,
    crank_dead_zone: crankDeadZone,
  };
}

export async function setActivityControl(patch: Partial<ActivityControlState>): Promise<ActivityControlState> {
  if (patch.crank_enabled !== undefined) crankEnabled = patch.crank_enabled;
  if (patch.posting_enabled !== undefined) postingEnabled = patch.posting_enabled;
  if (patch.crank_dead_zone !== undefined) crankDeadZone = patch.crank_dead_zone;
  const value: ActivityControlState = {
    crank_enabled: crankEnabled,
    posting_enabled: postingEnabled,
    crank_dead_zone: crankDeadZone,
  };
  await updateSetting(KEY, value);
  return value;
}

/** SNS 심사 통과 전 — 네이버 블로그만 큐 등록 (HUMA_NAVER_BLOG_ONLY=false 로 해제) */
export function isNaverBlogOnlyMode(): boolean {
  return process.env.HUMA_NAVER_BLOG_ONLY !== 'false';
}

const POSTING_ACTIVITY_JOB_TYPES = new Set([
  'post_blog',
  'content_full',
  'cafe_new_post',
  'cafe_reply',
]);

export function isPostingActivityJobType(jobType?: string): boolean {
  return Boolean(jobType && POSTING_ACTIVITY_JOB_TYPES.has(jobType));
}

export function isCrankActivityJobType(jobType?: string): boolean {
  return jobType === 'social_crank';
}

/** KST 01~04시 — C-Rank 전용 활동 금지 (포스팅 23~08과 별도) */
export function isCrankDeadZoneActive(from = new Date()): boolean {
  if (!crankDeadZone) return false;
  return isKstNightBan(CRANK_DEAD_ZONE_START, CRANK_DEAD_ZONE_END, from);
}

export function msUntilCrankDeadZoneEnd(from = new Date()): number {
  return msUntilNightBanEnd(CRANK_DEAD_ZONE_START, CRANK_DEAD_ZONE_END, from);
}
