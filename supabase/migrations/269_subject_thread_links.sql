-- Migration 269 — Liens causaux entre fils thématiques inter-PV
--
-- Doctrine :
--   Un lien "confirmed" est la seule source de vérité du graphe causal.
--   Les liens "suggested" (machine) sont une aide à la décision, jamais une vérité.
--
-- Convention de lecture :
--   La flèche va du préalable / de la cause vers la conséquence.
--   from_thread_id ──link_type──▶ to_thread_id
--   Exemple : Rapport G3 ──enables──▶ Validation MOE
--
-- link_type (vocabulaire orienté, flèche = cause → conséquence) :
--   requires  : A requiert B au préalable (B doit exister/être done avant A)
--   enables   : A permet B de démarrer ou d'avancer
--   causes    : A déclenche ou provoque B
--   validates : A valide ou qualifie B
--   replaces  : A remplace B (B devient obsolète)
--   relates_to: lien thématique sans causalité directe
--
-- source :
--   human         : lien créé manuellement par un utilisateur
--   extraction    : suggéré par l'analyse LLM du contenu des PV
--   cooccurrence  : suggéré par la présence répétée dans les mêmes PV + signaux textuels

CREATE TABLE subject_thread_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  from_thread_id      UUID NOT NULL,
  to_thread_id        UUID NOT NULL,
  link_type           TEXT NOT NULL CHECK (link_type IN (
                        'requires', 'enables', 'causes', 'validates', 'replaces', 'relates_to'
                      )),
  status              TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN (
                        'suggested', 'confirmed', 'rejected'
                      )),
  source              TEXT NOT NULL CHECK (source IN (
                        'human', 'extraction', 'cooccurrence'
                      )),
  confidence          NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  justification       TEXT,          -- pourquoi ce lien a été suggéré (signaux détectés)
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Preuves documentaires associées à la suggestion
  evidence_run_id     UUID REFERENCES document_extraction_run(id) ON DELETE SET NULL,
  evidence_proposal_id UUID REFERENCES document_extraction_proposal(id) ON DELETE SET NULL,

  -- Un seul lien entre deux fils dans un sens donné
  CONSTRAINT subject_thread_links_unique UNIQUE (site_id, from_thread_id, to_thread_id, link_type),
  -- Pas d'auto-référence
  CONSTRAINT subject_thread_links_no_self CHECK (from_thread_id <> to_thread_id)
);

CREATE INDEX idx_subject_thread_links_site   ON subject_thread_links(site_id);
CREATE INDEX idx_subject_thread_links_from   ON subject_thread_links(from_thread_id);
CREATE INDEX idx_subject_thread_links_to     ON subject_thread_links(to_thread_id);
CREATE INDEX idx_subject_thread_links_status ON subject_thread_links(status);

-- RLS : lecture par les membres du site, écriture par les managers+
ALTER TABLE subject_thread_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subject_thread_links_select"
  ON subject_thread_links FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sites s
      JOIN organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = subject_thread_links.site_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "subject_thread_links_insert"
  ON subject_thread_links FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sites s
      JOIN organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = subject_thread_links.site_id
        AND om.user_id = auth.uid()
        AND om.role IN ('admin', 'manager', 'chef_equipe')
    )
  );

CREATE POLICY "subject_thread_links_update"
  ON subject_thread_links FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM sites s
      JOIN organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = subject_thread_links.site_id
        AND om.user_id = auth.uid()
        AND om.role IN ('admin', 'manager', 'chef_equipe')
    )
  );
