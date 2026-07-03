-- YouTube Shorts — 제목+해시태그 / 설명 분리 (수동 업로드·API)
ALTER TABLE huma_video_content_history
  ADD COLUMN IF NOT EXISTS caption_youtube_title TEXT,
  ADD COLUMN IF NOT EXISTS caption_youtube_description TEXT;

UPDATE huma_video_content_history
SET caption_youtube_description = caption_youtube
WHERE caption_youtube IS NOT NULL
  AND caption_youtube_description IS NULL
  AND caption_youtube_title IS NULL;
