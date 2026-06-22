-- 계정별 자동발행 ON/OFF · 당일 계획 건수 · 다음 content_full 트리거 시각

ALTER TABLE huma_accounts
  ADD COLUMN IF NOT EXISTS auto_publish_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_publish_kst_date VARCHAR(10),
  ADD COLUMN IF NOT EXISTS auto_publish_planned_count INTEGER,
  ADD COLUMN IF NOT EXISTS auto_publish_next_slot_at TIMESTAMPTZ;

COMMENT ON COLUMN huma_accounts.auto_publish_enabled IS '자동발행 ON — 스케줄러가 당일 계획 건수까지 content_full 등록';
COMMENT ON COLUMN huma_accounts.auto_publish_kst_date IS 'auto_publish_planned_count 기준 KST YYYY-MM-DD';
COMMENT ON COLUMN huma_accounts.auto_publish_planned_count IS '해당 KST일 목표 발행 건수(켜는 날 고정, 재켜도 상향 안 함)';
COMMENT ON COLUMN huma_accounts.auto_publish_next_slot_at IS '다음 content_full 자동 등록 예정 시각(UTC)';

CREATE INDEX IF NOT EXISTS idx_huma_accounts_auto_publish_next
  ON huma_accounts (auto_publish_next_slot_at)
  WHERE auto_publish_enabled = true AND auto_publish_next_slot_at IS NOT NULL;
