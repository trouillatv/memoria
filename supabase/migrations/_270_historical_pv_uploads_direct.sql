-- Migration 270 — Tracking des uploads PV historiques (application directe)

-- Check if table exists before creating
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename = 'historical_pv_uploads'
  ) THEN

    CREATE TABLE historical_pv_uploads (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      storage_path      TEXT NOT NULL UNIQUE,
      original_filename TEXT NOT NULL,
      file_size         BIGINT NOT NULL,
      file_hash_sha256  TEXT,
      effective_date    DATE,
      status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending', 'uploaded', 'confirmed', 'failed'
                        )),
      document_id       UUID REFERENCES documents(id) ON DELETE SET NULL,
      error_message     TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      uploaded_at       TIMESTAMPTZ,
      confirmed_at      TIMESTAMPTZ
    );

    CREATE INDEX idx_historical_pv_uploads_site   ON historical_pv_uploads(site_id);
    CREATE INDEX idx_historical_pv_uploads_status ON historical_pv_uploads(status);
    CREATE INDEX idx_historical_pv_uploads_created ON historical_pv_uploads(created_at);

    ALTER TABLE historical_pv_uploads ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "historical_pv_uploads_select"
      ON historical_pv_uploads FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM sites s
          JOIN organization_memberships om ON om.organization_id = s.organization_id
          WHERE s.id = historical_pv_uploads.site_id
            AND om.user_id = auth.uid()
        )
      );

    CREATE POLICY "historical_pv_uploads_insert"
      ON historical_pv_uploads FOR INSERT
      WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM sites s
          JOIN organization_memberships om ON om.organization_id = s.organization_id
          WHERE s.id = historical_pv_uploads.site_id
            AND om.user_id = auth.uid()
            AND om.role IN ('admin', 'manager', 'chef_equipe')
        )
      );

    CREATE POLICY "historical_pv_uploads_update"
      ON historical_pv_uploads FOR UPDATE
      USING (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM sites s
          JOIN organization_memberships om ON om.organization_id = s.organization_id
          WHERE s.id = historical_pv_uploads.site_id
            AND om.user_id = auth.uid()
            AND om.role IN ('admin', 'manager', 'chef_equipe')
        )
      );

    RAISE NOTICE 'Migration 270 applied successfully';
  ELSE
    RAISE NOTICE 'Migration 270 skipped (table already exists)';
  END IF;
END $$;
