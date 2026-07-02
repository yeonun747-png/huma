-- 네이버 계정 교체 시 워밍업 일차·단계 재시작 — 이 시각 이전 post_blog 는 집계 제외
ALTER TABLE huma_accounts
  ADD COLUMN IF NOT EXISTS posting_warmup_epoch_at TIMESTAMPTZ;

COMMENT ON COLUMN huma_accounts.posting_warmup_epoch_at IS
  '포스팅 네이버 ID 교체 시각 — 이후 발행만 warmup_day·일차 UI 집계';
