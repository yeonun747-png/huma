-- v3.61 콘티 작성 소요 시간(초)

ALTER TABLE huma_video_content_history
  ADD COLUMN IF NOT EXISTS conti_generation_sec INTEGER;

COMMENT ON COLUMN huma_video_content_history.conti_generation_sec IS
  'conti_generating 시작(created_at)부터 conti_ready·보류·실패까지 경과 초';
