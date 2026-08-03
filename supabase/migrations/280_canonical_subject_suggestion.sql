-- Migration 280 — canonical_subject_suggestion : résolution sémantique shadow
--
-- Lot 2 du moteur canonical_subject.
--
-- Contexte :
--   Quand le moteur lexical (étape 1) ne trouve aucun thread antérieur pour une
--   proposition, celle-ci reçoit un UUID orphelin. Cette table stocke la décision
--   du résolveur LLM (étape 2) sur ces orphelins — SANS modifier les données
--   existantes (shadow mode).
--
-- Shadow mode :
--   Aucun subject_thread_id ni canonical_subject_id n'est modifié.
--   shadow_decision encode uniquement ce que le système AURAIT fait en mode actif :
--   - would_auto_assign : model_confidence >= 0.90
--   - would_suggest     : 0.70 <= model_confidence < 0.90
--   - no_match          : model_confidence < 0.70 ou aucun candidat
--
-- Idempotence :
--   UNIQUE (subject_thread_id, resolver_version) permet de rejouer une version
--   améliorée du résolveur sans contaminer les mesures des versions précédentes.
--
-- Audit :
--   candidate_count : combien de candidats ont été présentés au LLM.
--   resolver_version, model_name : traçabilité de la version et du modèle utilisés.
--   model_confidence est DISTINCT d'une probabilité calibrée — c'est l'auto-évaluation
--   du modèle, à mesurer empiriquement (objectif du Lot 2).

CREATE TABLE public.canonical_subject_suggestion (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                     UUID        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  subject_thread_id           UUID        NOT NULL,
  extraction_run_id           UUID        REFERENCES public.document_extraction_run(id) ON DELETE SET NULL,
  proposal_label              TEXT        NOT NULL,
  proposal_family             TEXT        NOT NULL,
  candidate_canonical_subject_id UUID     REFERENCES public.canonical_subject(id) ON DELETE SET NULL,
  model_confidence            NUMERIC(4,3)
                                CHECK (model_confidence IS NULL OR (model_confidence >= 0 AND model_confidence <= 1)),
  reasoning                   TEXT,
  shadow_decision             TEXT        NOT NULL DEFAULT 'no_match'
                                CHECK (shadow_decision IN ('would_auto_assign', 'would_suggest', 'no_match')),
  resolver_version            TEXT        NOT NULL DEFAULT 'v1',
  model_name                  TEXT,
  candidate_count             INTEGER,
  resolution                  TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (resolution IN ('pending', 'accepted', 'rejected')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at                 TIMESTAMPTZ,
  resolved_by                 UUID        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Idempotence par version du résolveur : un thread peut être réévalué si
  -- resolver_version change (nouveau modèle, nouveau prompt, nouveau seuil).
  CONSTRAINT css_unique_thread_version UNIQUE (subject_thread_id, resolver_version)
);

CREATE INDEX idx_css_site        ON public.canonical_subject_suggestion(site_id);
CREATE INDEX idx_css_run         ON public.canonical_subject_suggestion(extraction_run_id);
CREATE INDEX idx_css_candidate   ON public.canonical_subject_suggestion(candidate_canonical_subject_id);
CREATE INDEX idx_css_decision    ON public.canonical_subject_suggestion(site_id, shadow_decision);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.canonical_subject_suggestion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "css_select"
  ON public.canonical_subject_suggestion FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = canonical_subject_suggestion.site_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "css_insert"
  ON public.canonical_subject_suggestion FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = canonical_subject_suggestion.site_id
        AND om.user_id = auth.uid()
        AND om.role IN ('admin', 'manager', 'chef_equipe')
    )
  );

CREATE POLICY "css_update"
  ON public.canonical_subject_suggestion FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = canonical_subject_suggestion.site_id
        AND om.user_id = auth.uid()
        AND om.role IN ('admin', 'manager', 'chef_equipe')
    )
  );
