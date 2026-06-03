-- v3.26: TTS 기본 경로 제거 — Kling 3.0 내장 오디오만 사용
-- huma_settings higgsfield.default_tts_model 제거

UPDATE huma_settings
SET value = value - 'default_tts_model',
    updated_at = now()
WHERE key = 'higgsfield'
  AND value ? 'default_tts_model';
