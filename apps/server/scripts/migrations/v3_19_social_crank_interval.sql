-- v3.19: C-Rank 동일 블로그 방문 간격 5일 (규칙 ⑪, v3.18의 3일 설정 복원)

UPDATE huma_settings
SET value = jsonb_set(value, '{min_visit_interval_days}', '5'),
    updated_at = now()
WHERE key = 'social_crank';
