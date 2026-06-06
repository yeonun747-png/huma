-- v3.37 연운 포스팅 proxy_port 정정 + persona 컬럼
-- Supabase SQL Editor에서 실행

ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS persona JSONB;

-- 현황 확인
SELECT id, name, proxy_port, slot_label, persona IS NOT NULL AS has_persona
FROM huma_accounts
WHERE account_type = 'posting' AND workspace = 'yeonun'
ORDER BY name;

-- 연운1~3 동글 포트 정정 (동글1=:10001 · 동글2=:10002 · 동글3=:10003)
UPDATE huma_accounts SET proxy_port = 10001, slot_label = '연운1'
WHERE account_type = 'posting' AND workspace = 'yeonun' AND name = '연운1';

UPDATE huma_accounts SET proxy_port = 10002, slot_label = '연운2'
WHERE account_type = 'posting' AND workspace = 'yeonun' AND name = '연운2';

UPDATE huma_accounts SET proxy_port = 10003, slot_label = '연운3'
WHERE account_type = 'posting' AND workspace = 'yeonun' AND name = '연운3';

-- 결과 확인 (10001 · 10002 · 10003 이어야 함)
SELECT id, name, proxy_port, slot_label
FROM huma_accounts
WHERE account_type = 'posting' AND workspace = 'yeonun'
ORDER BY proxy_port;
