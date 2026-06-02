-- v3.29: 환경설정 UI ↔ worker 정책 연동용 app_settings 기본값
INSERT INTO huma_settings (key, value) VALUES
('app_settings', '{"claude_api":true,"higgsfield_api":true,"slack_webhook":true,"daily_limit":true,"night_ban":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

UPDATE huma_settings
SET value = value || '{"gradual_recovery":true}'::jsonb
WHERE key = 'watcher' AND NOT (value ? 'gradual_recovery');
