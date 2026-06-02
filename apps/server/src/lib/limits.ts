export const PLATFORM_DAILY_LIMITS: Record<string, number> = {
  post_blog: 30,
  cafe_new_post: 5,
  cafe_reply: 15,
  social_crank: 30,
  tiktok_upload: 5,
  instagram_reel: 25,
  youtube_upload: 2,
  instagram_post: 25,
  threads_post: 250,
  threads_reply: 250,
  twitter_post: 50,
  twitter_reply: 50,
  video_pipeline: 999,
};

export const SHARED_WORKSPACE_LIMITS = [
  { workspaces: ['quizoasis', 'panana'] as const, jobTypes: ['post_blog'], limit: 30 },
];

export function getDailyLimit(jobType: string): number {
  return PLATFORM_DAILY_LIMITS[jobType] ?? 30;
}
