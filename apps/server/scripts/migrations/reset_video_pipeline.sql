-- 영상 파이프라인 초기화 (개발/테스트용 · Supabase SQL Editor — 전체 선택 후 1회 Run)
-- huma_video_queue + video_pipeline job + 타입 B 연동 paused job 정리

-- 1) 관련 job 로그
DELETE FROM huma_logs
WHERE job_id IN (
  SELECT id FROM huma_jobs WHERE job_type = 'video_pipeline'
  UNION
  SELECT job_id FROM huma_video_queue WHERE job_id IS NOT NULL
  UNION
  SELECT blog_job_id FROM huma_video_queue WHERE blog_job_id IS NOT NULL
  UNION
  SELECT threads_job_id FROM huma_video_queue WHERE threads_job_id IS NOT NULL
  UNION
  SELECT twitter_job_id FROM huma_video_queue WHERE twitter_job_id IS NOT NULL
);

-- 2) 영상 큐
DELETE FROM huma_video_queue;

-- 3) video_pipeline job
DELETE FROM huma_jobs WHERE job_type = 'video_pipeline';

-- 4) 영상 대기 중이던 타입 B 연동 job (paused)
DELETE FROM huma_jobs
WHERE content_type = 'B'
  AND status = 'paused'
  AND job_type IN ('post_blog', 'threads_post', 'twitter_post');

-- 확인 (선택)
-- SELECT COUNT(*) AS video_queue FROM huma_video_queue;
-- SELECT COUNT(*) AS video_jobs FROM huma_jobs WHERE job_type = 'video_pipeline';
