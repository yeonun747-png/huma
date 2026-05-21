-- v3.10: C-Rank 동일 블로그 방문 간격 3일 → 5일 (데이터 최적화)
UPDATE huma_settings
SET value = jsonb_set(COALESCE(value, '{}'::jsonb), '{min_visit_interval_days}', '5'::jsonb)
WHERE key = 'social_crank';
