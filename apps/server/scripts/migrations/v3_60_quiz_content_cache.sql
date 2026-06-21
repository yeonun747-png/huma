-- v3.60 퀴즈오아시스 콘텐츠 캐시 (영상 펀치라인용)
-- Supabase SQL Editor에서 수동 실행

CREATE TABLE IF NOT EXISTS huma_quiz_content_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_external_id VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(200),
  title VARCHAR(300) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'active',
  synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_huma_qcc_status
  ON huma_quiz_content_cache(status);

CREATE INDEX IF NOT EXISTS idx_huma_vch_workspace_used_quiz
  ON huma_video_content_history(workspace, used_quiz_id, created_at DESC);
