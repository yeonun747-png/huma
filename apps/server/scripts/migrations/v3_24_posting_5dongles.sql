-- 포스팅 5동글: 연운 10001~10003 · 퀴즈 10004 · 파나나 10005
-- C-Rank 2동글: 10006~10007 (i7 7슬롯 기준)

UPDATE huma_modems SET modem_role = 'posting' WHERE proxy_port BETWEEN 10001 AND 10005;
UPDATE huma_modems SET modem_role = 'crank' WHERE proxy_port IN (10006, 10007);

-- 계정 포트는 v3_25_dongle_physical_slots.sql (파나나=4·퀴즈=5)
