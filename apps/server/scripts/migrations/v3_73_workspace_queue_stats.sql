-- 워크스페이스 큐 집계 캐시 — /api/jobs/page 완료 전체 스캔 제거
-- pending/running 은 API에서 head count, done·total 은 이 테이블

CREATE TABLE IF NOT EXISTS huma_workspace_queue_stats (
  workspace TEXT PRIMARY KEY,
  queue_visible_total INTEGER NOT NULL DEFAULT 0,
  done_all INTEGER NOT NULL DEFAULT 0,
  done_today INTEGER NOT NULL DEFAULT 0,
  stats_kst_date VARCHAR(10) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE huma_workspace_queue_stats IS '포스팅 큐 UI — 완료·페이지 total 캐시 (job 변경 시 갱신)';
COMMENT ON COLUMN huma_workspace_queue_stats.queue_visible_total IS '파이프라인 셸 제외 전체 job 수 (pagination total)';
COMMENT ON COLUMN huma_workspace_queue_stats.done_all IS '완료(visible) 전체';
COMMENT ON COLUMN huma_workspace_queue_stats.done_today IS 'KST 오늘 완료(visible, post_blog는 posts 발행일 규칙)';
COMMENT ON COLUMN huma_workspace_queue_stats.stats_kst_date IS 'done_today 기준 KST YYYY-MM-DD';

ALTER TABLE huma_workspace_queue_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service only" ON huma_workspace_queue_stats;
CREATE POLICY "service only" ON huma_workspace_queue_stats
  FOR ALL TO service_role USING (true);
