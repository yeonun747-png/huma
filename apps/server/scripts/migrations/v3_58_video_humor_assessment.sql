-- v3.58 콘티 유머 자가 평가 (Haiku 별도 호출)
-- Supabase SQL Editor에서 수동 실행

ALTER TABLE huma_video_content_history
  ADD COLUMN IF NOT EXISTS self_assessed_humor TEXT,
  ADD COLUMN IF NOT EXISTS retry_count_for_humor INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN huma_video_content_history.self_assessed_humor IS
  'Haiku 별도 호출 유머 평가 — funny | dull';
COMMENT ON COLUMN huma_video_content_history.retry_count_for_humor IS
  '유머 dull 판정 후 Sonnet 재생성 시도 횟수 (0~2)';
