import { getSetting, updateSetting } from './settings.js';

const KEY = 'activity_control';

export interface ActivityControlState {
  crank_enabled: boolean;
  posting_enabled: boolean;
}

let crankEnabled = true;
let postingEnabled = true;

export async function initActivityControl(): Promise<void> {
  const state = await getSetting<ActivityControlState>(KEY, {
    crank_enabled: true,
    posting_enabled: true,
  });
  crankEnabled = state.crank_enabled !== false;
  postingEnabled = state.posting_enabled !== false;
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
  };
}

export async function setActivityControl(patch: Partial<ActivityControlState>): Promise<ActivityControlState> {
  if (patch.crank_enabled !== undefined) crankEnabled = patch.crank_enabled;
  if (patch.posting_enabled !== undefined) postingEnabled = patch.posting_enabled;
  const value: ActivityControlState = {
    crank_enabled: crankEnabled,
    posting_enabled: postingEnabled,
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
