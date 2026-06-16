-- v3.44 — 블로그 지수 분석 v3 (session_status · idx_score nullable)

ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS session_status VARCHAR(20) DEFAULT 'active';

UPDATE huma_accounts
SET session_status = 'active'
WHERE session_status IS NULL AND is_active = true;

UPDATE huma_accounts
SET session_status = 'error'
WHERE session_status IS NULL AND is_active = false;

ALTER TABLE blog_index_history ALTER COLUMN idx_score DROP NOT NULL;
