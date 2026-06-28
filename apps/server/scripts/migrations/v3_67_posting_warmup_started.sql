-- 자동발행 워밍업 기준일 — huma 자동발행 시작 이후 발행일만 일차 집계
ALTER TABLE huma_accounts
  ADD COLUMN IF NOT EXISTS posting_warmup_started_kst DATE;

COMMENT ON COLUMN huma_accounts.posting_warmup_started_kst IS
  '자동발행 워밍업 기준 KST일 — 이 날짜 이후 post_blog 발행일만 warmup_day 보정에 사용';
