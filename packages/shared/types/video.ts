import type { Workspace } from './account';

export type VideoPipelineStatus =
  | 'pending'
  | 'image_generating'
  | 'video_generating'
  | 'tts_generating'
  | 'ffmpeg_merging'
  | 'uploading'
  | 'done'
  | 'failed';

export interface HumaVideoQueue {
  id: string;
  workspace: Workspace;
  job_id?: string;
  image_model: string;
  image_prompt?: string;
  generated_image_url?: string;
  video_model: string;
  video_prompt?: string;
  duration_sec: number;
  source_video_url?: string;
  tts_model: string;
  tts_script?: string;
  tts_audio_url?: string;
  bgm_url?: string;
  output_video_path?: string;
  upload_platforms?: string[];
  caption?: string;
  hashtags?: string[];
  blog_job_id?: string;
  threads_job_id?: string;
  twitter_job_id?: string;
  tiktok_result_url?: string;
  instagram_result_url?: string;
  youtube_result_url?: string;
  status: VideoPipelineStatus;
  current_step?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}
