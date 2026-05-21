-- v3.7: Anti-Detect · 페르소나 · 워밍업 · 세션 영속성
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS fingerprint JSONB;
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS persona JSONB;
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS profile_path TEXT;
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS warmup_day INTEGER DEFAULT 0;
