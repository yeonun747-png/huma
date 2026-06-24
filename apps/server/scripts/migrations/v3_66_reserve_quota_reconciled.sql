-- reserve_posting_quota_slot: TS countTodayPostBlogPublished 와 동일 집계
-- v3_62(completed_at>=오늘) 는 ✓발행확인(reconcile) job 이 TS=0 / SQL=1 불일치 → 자동발행 무한 실패

CREATE OR REPLACE FUNCTION job_published_kst_date(p_job huma_jobs)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_ts timestamptz;
  v_ps jsonb;
  v_reconciled boolean;
  v_completed timestamptz;
BEGIN
  v_ps := COALESCE(p_job.platform_schedule, '{}'::jsonb);
  v_reconciled := COALESCE(v_ps->>'_reconciled_from_failed', 'false') = 'true';
  v_completed := p_job.completed_at;

  IF v_ps ? '_publish_scheduled_at' AND length(trim(v_ps->>'_publish_scheduled_at')) > 0 THEN
    BEGIN
      v_ts := (v_ps->>'_publish_scheduled_at')::timestamptz;
      RETURN (v_ts AT TIME ZONE 'Asia/Seoul')::date;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  IF v_ps ? '_reconcile_publish_at' AND length(trim(v_ps->>'_reconcile_publish_at')) > 0 THEN
    BEGIN
      v_ts := (v_ps->>'_reconcile_publish_at')::timestamptz;
      IF v_completed IS NOT NULL AND abs(extract(epoch FROM (v_ts - v_completed))) < 900 THEN
        IF v_reconciled THEN
          RETURN NULL;
        END IF;
      ELSE
        RETURN (v_ts AT TIME ZONE 'Asia/Seoul')::date;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  IF v_reconciled THEN
    RETURN NULL;
  END IF;

  IF v_completed IS NOT NULL THEN
    RETURN (v_completed AT TIME ZONE 'Asia/Seoul')::date;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION reserve_posting_quota_slot(
  p_account_id UUID,
  p_kst_date TEXT,
  p_daily_target INTEGER,
  p_hard_cap INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reserved INTEGER;
  v_reserved_date TEXT;
  v_completed BIGINT;
  v_in_flight BIGINT;
BEGIN
  IF p_daily_target < 1 OR p_hard_cap < 1 THEN
    RETURN FALSE;
  END IF;

  SELECT posting_reserved_today, posting_reserved_kst_date
    INTO v_reserved, v_reserved_date
    FROM huma_accounts
   WHERE id = p_account_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND';
  END IF;

  IF v_reserved_date IS DISTINCT FROM p_kst_date THEN
    v_reserved := 0;
  END IF;

  SELECT COUNT(*) INTO v_completed
    FROM huma_jobs j
   WHERE j.account_id = p_account_id
     AND j.job_type = 'post_blog'
     AND j.status = 'completed'
     AND j.result_url IS NOT NULL
     AND job_published_kst_date(j) = p_kst_date::date;

  IF v_completed >= p_hard_cap THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*) INTO v_in_flight
    FROM huma_jobs
   WHERE account_id = p_account_id
     AND created_at >= (p_kst_date || 'T00:00:00+09:00')::timestamptz
     AND (
       (job_type = 'content_full' AND status IN ('pending', 'scheduled', 'running'))
       OR (job_type = 'post_blog' AND status IN ('pending', 'scheduled', 'running', 'awaiting_captcha'))
     );

  IF v_completed + v_in_flight + v_reserved >= p_daily_target THEN
    RETURN FALSE;
  END IF;

  UPDATE huma_accounts
     SET posting_reserved_today = v_reserved + 1,
         posting_reserved_kst_date = p_kst_date,
         updated_at = now()
   WHERE id = p_account_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.job_published_kst_date(huma_jobs) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.job_published_kst_date(huma_jobs) FROM anon;
REVOKE ALL ON FUNCTION public.job_published_kst_date(huma_jobs) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.job_published_kst_date(huma_jobs) TO service_role;
