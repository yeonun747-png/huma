-- v3.26: 환경설정 API 분리 (Imagen 4 / Higgsfield 영상 / Haiku 서브)

UPDATE huma_settings
SET value = value
  || '{"claude_haiku_api":true,"google_imagen_api":true}'::jsonb,
    updated_at = now()
WHERE key = 'app_settings'
  AND NOT (value ? 'google_imagen_api');

UPDATE huma_settings
SET value = jsonb_set(
  value,
  '{google_imagen_api}',
  to_jsonb(COALESCE((value->>'higgsfield_api')::boolean, true))
)
WHERE key = 'app_settings'
  AND value ? 'higgsfield_api'
  AND NOT (value ? 'google_imagen_api');

UPDATE huma_settings
SET value = value || '{"video_duration_sec":15}'::jsonb,
    updated_at = now()
WHERE key = 'higgsfield'
  AND NOT (value ? 'video_duration_sec');
