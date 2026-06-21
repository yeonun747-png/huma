-- v3.59 서비스 단위 영상 페르소나 + 펀치라인 메타 컬럼
-- Supabase SQL Editor에서 수동 실행

CREATE TABLE IF NOT EXISTS huma_video_persona (
  workspace VARCHAR(20) PRIMARY KEY,
  persona_text TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE huma_video_content_history
  ADD COLUMN IF NOT EXISTS punchline_idea TEXT,
  ADD COLUMN IF NOT EXISTS hook_subtype VARCHAR(100),
  ADD COLUMN IF NOT EXISTS used_product VARCHAR(200),
  ADD COLUMN IF NOT EXISTS used_quiz_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_huma_vch_workspace_hook_subtype
  ON huma_video_content_history(workspace, hook_subtype, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_huma_vch_workspace_used_product
  ON huma_video_content_history(workspace, used_product, created_at DESC);
