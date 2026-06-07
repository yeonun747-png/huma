-- 전체 중지 상태 — huma_settings에 영속 (재배포·pm2 restart 후에도 유지)
INSERT INTO huma_settings (key, value)
VALUES ('system_paused', '{"paused":false}')
ON CONFLICT (key) DO NOTHING;
