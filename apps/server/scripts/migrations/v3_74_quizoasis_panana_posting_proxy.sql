-- 퀴즈오아시스·파나나 포스팅 계정 proxy_port 정규화 (단일 동글 N계정)
-- 퀴즈 :10005 · 파나나 :10004 (v3.25 이후 기준)

UPDATE huma_accounts
SET proxy_port = 10005
WHERE account_type = 'posting'
  AND workspace = 'quizoasis'
  AND (proxy_port IS NULL OR proxy_port <> 10005);

UPDATE huma_accounts
SET proxy_port = 10004
WHERE account_type = 'posting'
  AND workspace = 'panana'
  AND (proxy_port IS NULL OR proxy_port <> 10004);
