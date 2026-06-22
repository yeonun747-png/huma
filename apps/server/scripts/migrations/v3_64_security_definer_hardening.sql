-- Supabase Security Advisor: search_path 고정 + SECURITY DEFINER RPC execute 제한
-- reserve/release_posting_quota_slot — 서버(service_role) 전용

CREATE OR REPLACE FUNCTION huma_crank_letter_label(idx INT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  n INT := idx + 1;
  s TEXT := '';
  r INT;
BEGIN
  WHILE n > 0 LOOP
    r := (n - 1) % 26;
    s := CHR(65 + r) || s;
    n := (n - 1) / 26;
  END LOOP;
  RETURN 'CRANK-' || s;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_posting_quota_slot(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_posting_quota_slot(UUID, TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_posting_quota_slot(UUID, TEXT, INTEGER, INTEGER) FROM authenticated;

REVOKE ALL ON FUNCTION public.release_posting_quota_slot(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_posting_quota_slot(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.release_posting_quota_slot(UUID, TEXT) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_posting_quota_slot(UUID, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_posting_quota_slot(UUID, TEXT) TO service_role;
