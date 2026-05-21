-- v3.11: YouTube Shorts 업로드 결과 URL
ALTER TABLE huma_video_queue ADD COLUMN IF NOT EXISTS youtube_result_url TEXT;
