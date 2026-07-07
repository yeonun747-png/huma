-- v3.77 — 브루용 나레이션 대본 (연운·포춘82)

CREATE TABLE IF NOT EXISTS huma_fortune82_products_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id VARCHAR(40) NOT NULL UNIQUE,
  gc INTEGER,
  ic INTEGER,
  title VARCHAR(300) NOT NULL,
  teacher_name VARCHAR(200),
  intro TEXT,
  composition TEXT,
  price INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fortune82_products_status ON huma_fortune82_products_cache (status);

CREATE TABLE IF NOT EXISTS huma_narration_script_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace VARCHAR(32) NOT NULL,
  format_type VARCHAR(32) NOT NULL,
  axis_type VARCHAR(32) NOT NULL,
  topic_key VARCHAR(200) NOT NULL,
  topic_label VARCHAR(300) NOT NULL,
  title VARCHAR(500) NOT NULL DEFAULT '',
  script_body TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'script_generating',
  error_message TEXT,
  source_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_narration_script_ws_created
  ON huma_narration_script_history (workspace, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_narration_script_rotation
  ON huma_narration_script_history (workspace, format_type, axis_type, topic_key, created_at DESC);
