-- v3.9: Layer4 Watcher 추적 · 워밍업 일일 증가
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS layer4_detection_count_today INTEGER DEFAULT 0;
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS layer4_last_detection_at TIMESTAMPTZ;
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS layer4_recovery_tier INTEGER DEFAULT 0;
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS layer4_rest_until TIMESTAMPTZ;
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS warmup_last_increment_date DATE;

CREATE INDEX IF NOT EXISTS idx_huma_accounts_layer4_rest
  ON huma_accounts(layer4_rest_until)
  WHERE layer4_rest_until IS NOT NULL;
