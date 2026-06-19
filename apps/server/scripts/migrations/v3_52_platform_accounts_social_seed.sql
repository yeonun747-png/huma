-- v3.52 — 소셜 채널 등록 (토큰은 서버 .env, UI·스케줄러용 username만)
-- 계정관리에서 채널명 등록과 동일. ON CONFLICT 시 username만 갱신.

INSERT INTO huma_platform_accounts (workspace, platform, username, access_token, is_active)
VALUES
  ('yeonun', 'youtube', '@연운_Yeonun', 'env-managed', true),
  ('yeonun', 'tiktok', 'yeonun_kr', 'env-managed', true),
  ('yeonun', 'instagram', 'yeonun747', 'env-managed', true),
  ('yeonun', 'threads', 'yeonun747', 'env-managed', true),
  ('yeonun', 'twitter', 'yeonun_kr', 'env-managed', true),

  ('quizoasis', 'youtube', '@Quizoasis-퀴즈오아시스', 'env-managed', true),
  ('quizoasis', 'tiktok', 'goriccc', 'env-managed', true),
  ('quizoasis', 'instagram', 'myquizoasis', 'env-managed', true),
  ('quizoasis', 'threads', 'myquizoasis', 'env-managed', true),
  ('quizoasis', 'twitter', 'QuizOasis_kr', 'env-managed', true),

  ('panana', 'youtube', '@Panana-파나나', 'env-managed', true),
  ('panana', 'tiktok', 'panana_kr', 'env-managed', true),
  ('panana', 'instagram', 'cmunj2025', 'env-managed', true),
  ('panana', 'threads', 'cmunj2025', 'env-managed', true),
  ('panana', 'twitter', 'goriccc', 'env-managed', true)
ON CONFLICT (workspace, platform) DO UPDATE SET
  username = EXCLUDED.username,
  is_active = true;
