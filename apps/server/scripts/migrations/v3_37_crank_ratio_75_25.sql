-- v3.28 비율 조정: 타 블로그 75% / 우리 블로그 25% (v3_36 이미 실행한 DB용)
UPDATE huma_settings
SET value = jsonb_set(
  jsonb_set(COALESCE(value, '{}'::jsonb), '{our_blog_ratio}', '0.25'::jsonb),
  '{other_blog_ratio}',
  '0.75'::jsonb
),
    updated_at = now()
WHERE key = 'social_crank';
