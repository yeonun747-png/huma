-- social_crank 스케줄러: last_crank_at, 동글 월 데이터·일일 세션 카운트

ALTER TABLE huma_accounts
  ADD COLUMN IF NOT EXISTS last_crank_at TIMESTAMPTZ;

COMMENT ON COLUMN huma_accounts.last_crank_at IS '마지막 C-Rank(social_crank) 세션 완료 시각';

ALTER TABLE huma_modems
  ADD COLUMN IF NOT EXISTS monthly_data_mb NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crank_sessions_today INTEGER DEFAULT 0;

COMMENT ON COLUMN huma_modems.monthly_data_mb IS '당월 누적 데이터(MB). 세션당 +7.5MB, 2500MB 초과 시 스케줄 제외';
COMMENT ON COLUMN huma_modems.crank_sessions_today IS '당일 C-Rank 세션 수 (동글당 최대 6)';
