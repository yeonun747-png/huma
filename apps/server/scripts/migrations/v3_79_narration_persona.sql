-- v3.79 — 브루 나레이션 MC 페르소나 (연운·포춘82)

CREATE TABLE IF NOT EXISTS huma_narration_persona (
  workspace VARCHAR(32) PRIMARY KEY,
  persona_text TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE huma_narration_persona ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service only" ON huma_narration_persona;
CREATE POLICY "service only" ON huma_narration_persona FOR ALL TO service_role USING (true);
