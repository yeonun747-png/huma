-- v3.78 — 나레이션 주기(데일리/주간/월간)

ALTER TABLE huma_narration_script_history
  ADD COLUMN IF NOT EXISTS period_type VARCHAR(32) NOT NULL DEFAULT 'daily';

CREATE INDEX IF NOT EXISTS idx_narration_script_rotation_v2
  ON huma_narration_script_history (workspace, format_type, period_type, axis_type, topic_key, created_at DESC);
