-- v3.18: 카페 바이럴 연운 전용 (규칙 ㉛) + social_crank 방문 간격 3일

ALTER TABLE huma_cafe_viral_cafes
  ALTER COLUMN workspace SET DEFAULT 'yeonun';

UPDATE huma_cafe_viral_cafes
SET workspace = 'yeonun'
WHERE workspace IS DISTINCT FROM 'yeonun';

UPDATE huma_settings
SET value = (
  value
  || '{"target_workspace":"yeonun","note":"카페 침투는 연운 전용. 퀴즈·파나나는 카페 바이럴 미적용."}'::jsonb
) - 'keywords_quizoasis' - 'keywords_panana',
updated_at = now()
WHERE key = 'cafe_viral';

UPDATE huma_settings
SET value = jsonb_set(value, '{min_visit_interval_days}', '3'),
    updated_at = now()
WHERE key = 'social_crank';
