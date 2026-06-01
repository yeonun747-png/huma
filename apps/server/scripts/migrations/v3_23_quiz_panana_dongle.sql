-- 퀴즈오아시스(:10003) · 파나나(:10004) 포스팅 동글 1:1 전용
-- i7 ZTE 7슬롯 기준: slot3=eth2→10003, slot4=eth3→10004

UPDATE huma_modems SET modem_role = 'posting' WHERE proxy_port BETWEEN 10001 AND 10004;

-- 기존 포스팅 계정 동글 재할당 (workspace 기준)
UPDATE huma_accounts SET proxy_port = 10003
WHERE account_type = 'posting' AND workspace = 'quizoasis';

UPDATE huma_accounts SET proxy_port = 10004
WHERE account_type = 'posting' AND workspace = 'panana';

-- 연운은 10001~10002 중 비어 있는 포트 수동 확인 후 할당
-- SELECT id, name, workspace, proxy_port FROM huma_accounts WHERE account_type = 'posting';
