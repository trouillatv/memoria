-- Lectures IA pré-calculées — résonances et persistances sémantiques.
-- Doctrine : calcul à l'écriture (après embedding), lecture SQL simple.
-- Jamais de pgvector cosine live sur page load.

CREATE TABLE IF NOT EXISTS site_reading_candidates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,  -- single-tenant pilot : pas de table tenants
  site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  reading_type    text NOT NULL CHECK (reading_type IN ('resonance', 'persistence')),
  fragment        text NOT NULL,
  source_ids      jsonb NOT NULL DEFAULT '[]',
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'dismissed')),
  generated_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  algorithm_version text NOT NULL DEFAULT 'v1.5',
  internal_score  float8  -- jamais exposé en UI, audit interne seulement
);

CREATE INDEX IF NOT EXISTS site_reading_candidates_site_status
  ON site_reading_candidates (site_id, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS site_reading_candidates_tenant
  ON site_reading_candidates (tenant_id, status);

-- RLS : lecture réservée au service role (admin client).
-- Les pages accèdent via createAdminClient(), jamais via le client public.
ALTER TABLE site_reading_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON site_reading_candidates
  FOR ALL USING (auth.role() = 'service_role');
