-- v3.55 영상 콘티 등장인물 이름 기록
-- 동일 계정에서 이름 재사용 패턴 추적용

ALTER TABLE huma_video_content_history
  ADD COLUMN IF NOT EXISTS character_names TEXT[];

COMMENT ON COLUMN huma_video_content_history.character_names IS
  'v3.55 콘티에 부여된 등장인물 이름(A/B 라벨 제외). 계정별 이름 재사용 추적용';
