-- 포스팅 일일 쿼터 동시 등록 방지: 계정 행 잠금 + 예약 슬롯
-- content_full insert 직전 reserve → insert 성공 시 release (in-flight가 대체)

ALTER TABLE huma_accounts
  ADD COLUMN IF NOT EXISTS posting_reserved_today INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS posting_reserved_kst_date VARCHAR(10);

COMMENT ON COLUMN huma_accounts.posting_reserved_today IS 'KST 오늘 content_full 등록 예약 중(미 insert) 건수';
COMMENT ON COLUMN huma_accounts.posting_reserved_kst_date IS 'posting_reserved_today 기준 KST YYYY-MM-DD';

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
  v_since TIMESTAMPTZ;
BEGIN
  IF p_daily_target < 1 OR p_hard_cap < 1 THEN
    RETURN FALSE;
  END IF;

  v_since := (p_kst_date || 'T00:00:00+09:00')::timestamptz;

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
    FROM huma_jobs
   WHERE account_id = p_account_id
     AND job_type = 'post_blog'
     AND status = 'completed'
     AND completed_at >= v_since;

  IF v_completed >= p_hard_cap THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*) INTO v_in_flight
    FROM huma_jobs
   WHERE account_id = p_account_id
     AND created_at >= v_since
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

CREATE OR REPLACE FUNCTION release_posting_quota_slot(
  p_account_id UUID,
  p_kst_date TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE huma_accounts
     SET posting_reserved_today = GREATEST(0, posting_reserved_today - 1),
         posting_reserved_kst_date = p_kst_date,
         updated_at = now()
   WHERE id = p_account_id
     AND posting_reserved_kst_date = p_kst_date
     AND posting_reserved_today > 0;
END;
$$;
