-- 포스팅 5동글: 연운 10001~10003 · 퀴즈 10004 · 파나나 10005
-- C-Rank 2동글: 10006~10007 (i7 7슬롯 기준)

UPDATE huma_modems SET modem_role = 'posting' WHERE proxy_port BETWEEN 10001 AND 10005;
UPDATE huma_modems SET modem_role = 'crank' WHERE proxy_port IN (10006, 10007);

UPDATE huma_accounts SET proxy_port = 10004
WHERE account_type = 'posting' AND workspace = 'quizoasis';

UPDATE huma_accounts SET proxy_port = 10005
WHERE account_type = 'posting' AND workspace = 'panana';
