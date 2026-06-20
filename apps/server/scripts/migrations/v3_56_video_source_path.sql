-- v3.56 EvoLink 원본 영상 영구 경로 (자막 재입히기용)
-- Supabase SQL Editor에서 수동 실행

ALTER TABLE huma_video_content_history
  ADD COLUMN IF NOT EXISTS source_video_path TEXT;

COMMENT ON COLUMN huma_video_content_history.source_video_path IS
  'EvoLink 원본 mp4 서버 로컬 경로 (자막 없음). video_file_path는 자막 burn-in 최종본.';
