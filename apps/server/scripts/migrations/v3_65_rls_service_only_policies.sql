-- Supabase Security Advisor: RLS Enabled No Policy (Info)
-- 서버(service_role) 전용 — schema.sql · v3_16 cafe viral 테이블과 동일 패턴

DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'blog_index_history',
  'blog_post_status',
  'huma_panana_characters_cache',
  'huma_quiz_content_cache',
  'huma_subtitle_style_history',
  'huma_video_content_history',
  'huma_video_persona',
  'posts'
])
LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "service only" ON %I', t);
  EXECUTE format(
    'CREATE POLICY "service only" ON %I FOR ALL TO service_role USING (true)',
    t
  );
END LOOP; END $$;
