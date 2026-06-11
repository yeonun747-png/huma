-- v3.41 — C-Rank / 포스팅 활동 토글 (환경설정)
INSERT INTO huma_settings (key, value)
VALUES ('activity_control', '{"crank_enabled":true,"posting_enabled":true}')
ON CONFLICT (key) DO NOTHING;
