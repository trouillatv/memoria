-- Migration 279 — canonical_subject : identité sémantique durable des sujets de chantier
--
-- Contexte :
--   Le moteur lexical (subject_thread_id) assigne un UUID partagé entre les propositions
--   qui forment une chaîne continue de formulations similaires. Lorsque la formulation
--   change trop entre deux PV (ex. "Problème regard R4" → "Reprise du réseau pour
--   problème regard R4"), le moteur crée un orphelin avec un nouvel UUID, même si le
--   sujet physique est identique.
--
--   canonical_subject est la couche sémantique au-dessus du thread lexical : elle représente
--   l'identité durable du sujet ("Regard R4"), indépendante de la formulation du PV.
--
-- Architecture en trois niveaux :
--   canonical_subject          = identité (de quoi parle-t-on)
--   subject_thread_id (UUID)   = chaîne lexicale continue entre PVs successifs
--   document_extraction_proposal = ce que dit un PV précis à une date donnée
--
--   N subject_thread_id  →  1 canonical_subject  (faux éclatements fusionnés)
--   1 subject_thread_id  →  1 canonical_subject  (cas standard)
--
-- Lot 1 : schéma + backfill 1:1 automatique.
-- Lot 2 : résolution LLM sur les orphelins futurs.
-- Lot 3 : validation humaine + merges sur les faux éclatements connus.

-- ── TABLE : canonical_subject ─────────────────────────────────────────────────────────

CREATE TABLE public.canonical_subject (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  label       TEXT        NOT NULL,            -- label canonique, éditable par un humain
  aliases     TEXT[]      NOT NULL DEFAULT '{}',  -- formulations alternatives connues
  status      TEXT        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'merged', 'split')),
  merged_into UUID        REFERENCES public.canonical_subject(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_canonical_subject_site   ON public.canonical_subject(site_id);
CREATE INDEX idx_canonical_subject_status ON public.canonical_subject(site_id, status);

-- ── TABLE : subject_thread_identity ──────────────────────────────────────────────────
--
-- Mapping : subject_thread_id (UUID libre, sans table FK) → canonical_subject_id.
-- Un thread appartient à exactement un canonical_subject.
-- Un canonical_subject peut regrouper plusieurs threads (faux éclatements reconnus).
--
-- source :
--   'auto'   — seed 1:1 automatique (Lot 1), sans analyse sémantique
--   'llm'    — résolution par LLM avec score de confiance (Lot 2)
--   'manual' — merge ou correction effectués par un humain (Lot 3+)

CREATE TABLE public.subject_thread_identity (
  subject_thread_id    UUID        PRIMARY KEY,   -- UUID libre (pas de FK table)
  site_id              UUID        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  canonical_subject_id UUID        NOT NULL REFERENCES public.canonical_subject(id) ON DELETE CASCADE,
  confidence           NUMERIC(4,3)
                         CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  source               TEXT        NOT NULL DEFAULT 'auto'
                         CHECK (source IN ('auto', 'llm', 'manual')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at          TIMESTAMPTZ,
  reviewed_by          UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_sti_site       ON public.subject_thread_identity(site_id);
CREATE INDEX idx_sti_canonical  ON public.subject_thread_identity(canonical_subject_id);

-- ── RLS : canonical_subject ───────────────────────────────────────────────────────────

ALTER TABLE public.canonical_subject ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canonical_subject_select"
  ON public.canonical_subject FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = canonical_subject.site_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "canonical_subject_insert"
  ON public.canonical_subject FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = canonical_subject.site_id
        AND om.user_id = auth.uid()
        AND om.role IN ('admin', 'manager', 'chef_equipe')
    )
  );

CREATE POLICY "canonical_subject_update"
  ON public.canonical_subject FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = canonical_subject.site_id
        AND om.user_id = auth.uid()
        AND om.role IN ('admin', 'manager', 'chef_equipe')
    )
  );

-- ── RLS : subject_thread_identity ────────────────────────────────────────────────────

ALTER TABLE public.subject_thread_identity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subject_thread_identity_select"
  ON public.subject_thread_identity FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = subject_thread_identity.site_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "subject_thread_identity_insert"
  ON public.subject_thread_identity FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = subject_thread_identity.site_id
        AND om.user_id = auth.uid()
        AND om.role IN ('admin', 'manager', 'chef_equipe')
    )
  );

CREATE POLICY "subject_thread_identity_update"
  ON public.subject_thread_identity FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = subject_thread_identity.site_id
        AND om.user_id = auth.uid()
        AND om.role IN ('admin', 'manager', 'chef_equipe')
    )
  );
