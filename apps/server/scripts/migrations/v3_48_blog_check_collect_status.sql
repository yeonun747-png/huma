-- v3.48 — blog_post_status status에 collect(수집) 추가

ALTER TABLE blog_post_status DROP CONSTRAINT IF EXISTS blog_post_status_status_check;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'blog_post_status'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE blog_post_status DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE blog_post_status ADD CONSTRAINT blog_post_status_status_check
  CHECK (status IN ('strong', 'good', 'weak', 'collect', 'miss'));
