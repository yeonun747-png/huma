-- v3.57 영상 SSD 보관·자동 정리 설정
INSERT INTO huma_settings (key, value)
VALUES (
  'video_content_storage',
  '{
    "ssdCapGb": 50,
    "warnPercent": 80,
    "autoCleanupEnabled": false,
    "autoDeleteSourceDaysAfterUpload": 7,
    "autoDeleteSubtitledDays": 90
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;
