-- v3.5: 콘텐츠 타입 A/B 통합 파이프라인
ALTER TABLE huma_jobs ADD COLUMN IF NOT EXISTS content_type VARCHAR(5) DEFAULT 'A';

ALTER TABLE huma_video_queue ADD COLUMN IF NOT EXISTS blog_job_id UUID REFERENCES huma_jobs(id);
ALTER TABLE huma_video_queue ADD COLUMN IF NOT EXISTS threads_job_id UUID REFERENCES huma_jobs(id);
ALTER TABLE huma_video_queue ADD COLUMN IF NOT EXISTS twitter_job_id UUID REFERENCES huma_jobs(id);
ALTER TABLE huma_video_queue ADD COLUMN IF NOT EXISTS tiktok_result_url TEXT;
ALTER TABLE huma_video_queue ADD COLUMN IF NOT EXISTS instagram_result_url TEXT;
