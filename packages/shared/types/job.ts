import type { Workspace } from './account';

export type JobType =
  | 'post_blog'
  | 'cafe_new_post'
  | 'cafe_reply'
  | 'social_crank'
  | 'content_full'
  | 'video_pipeline'
  | 'tiktok_upload'
  | 'instagram_reel'
  | 'instagram_post'
  | 'threads_post'
  | 'threads_reply'
  | 'twitter_post'
  | 'twitter_reply'
  | 'pinterest_upload';

export type ContentType = 'A' | 'B';

export type JobStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'awaiting_captcha'
  | 'completed'
  | 'failed';

export interface HumaJob {
  id: string;
  bull_job_id?: string;
  account_id?: string;
  platform_account_id?: string;
  workspace?: Workspace;
  job_type: JobType;
  title?: string;
  content?: string;
  image_urls?: string[];
  link_url?: string;
  hashtags?: string[];
  platform?: string;
  content_type?: ContentType;
  content_type_auto?: boolean;
  video_model?: string;
  auto_scheduled?: boolean;
  platform_schedule?: Record<string, unknown>;
  scheduled_at?: string;
  repeat_rule?: string;
  status: JobStatus;
  retry_count: number;
  result_url?: string;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}
