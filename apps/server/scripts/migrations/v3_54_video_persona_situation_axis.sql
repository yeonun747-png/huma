-- v3.54 영상 페르소나 상황축 + 생성 이력
-- 페르소나 본문은 huma_accounts.persona->videoPersona JSON (situationAxes 등)
-- 생성 시 선택값은 huma_video_content_history.situation_axis 에 기록

ALTER TABLE huma_video_content_history
  ADD COLUMN IF NOT EXISTS situation_axis VARCHAR(100);

COMMENT ON COLUMN huma_video_content_history.situation_axis IS
  'v3.54 파나나 등 — 영상 생성 시 선택된 상황축 (relationship_axis 와 별도)';
