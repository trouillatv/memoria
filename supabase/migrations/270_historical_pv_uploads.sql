-- Migration 270 — Tracking des uploads PV historiques (idempotence + orphelins)
--
-- Doctrine :
--   L'upload et la confirmation sont deux étapes séparées par un réseau instable.
--   Une ligne ici garantit qu'un upload Storage réussi peut être confirmé même si
--   le client a perdu la connexion après le PUT.
--
-- États :
--   pending    : URL signée délivrée, fichier pas encore uploadé (ou en cours)
--   uploaded   : fichier présent dans Storage, document pas encore créé
--   confirmed  : document créé, extraction lancée ou terminée
--   failed     : échec irréversible (fichier corrompu, taille excessive post-upload, etc.)
--
-- Nettoyage des orphelins :
--   Un job quotidien supprime les fichiers Storage dont le statut est 'pending'
--   depuis > 24h (URL expirée, upload jamais finalisé).

CREATE TABLE historical_pv_uploads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  storage_path      TEXT NOT NULL UNIQUE,  -- chemin dans Supabase Storage
  original_filename TEXT NOT NULL,
  file_size         BIGINT NOT NULL,       -- octets déclarés au moment de la demande
  file_hash_sha256  TEXT,                  -- hash calculé côté client, vérifié côté serveur
  effective_date    DATE,                  -- date du PV (peut être fournie à la confirmation)
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                      'pending', 'uploaded', 'confirmed', 'failed'
                    )),
  document_id       UUID REFERENCES documents(id) ON DELETE SET NULL,  -- lié après confirmation
  error_message     TEXT,                  -- raison de l'échec si status='failed'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_at       TIMESTAMPTZ,           -- horodatage du PUT Storage réussi
  confirmed_at      TIMESTAMPTZ,           -- horodatage de la création du document

  -- Une seule tentative d'import par fichier Storage
  CONSTRAINT historical_pv_uploads_unique_path UNIQUE (storage_path)
);

CREATE INDEX idx_historical_pv_uploads_site   ON historical_pv_uploads(site_id);
CREATE INDEX idx_historical_pv_uploads_status ON historical_pv_uploads(status);
CREATE INDEX idx_historical_pv_uploads_created ON historical_pv_uploads(created_at);

-- RLS : lecture/écriture par les membres du site concerné
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
