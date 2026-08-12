-- 316_canonical_subject_links.sql
-- Relations canoniques entre sujets — P0-B1 terrain-first.
--
-- Doctrine :
--   - Une seule relation dominante par paire de canonical_subject, quel que soit le type.
--   - La contrainte d'unicité porte sur la paire normalisée (LEAST/GREATEST) pour
--     interdire les relations contradictoires sur la même paire.
--   - relates_to est interdit à la persistance (whitelist serveur dans le moteur).
--   - Chaque relation doit avoir au moins une preuve avec evidence_text traçable.
--
-- Architecture :
--   canonical_subject_occurrence (source terrain/réunion)
--     ↓
--   canonical_subject_links (relation qualifiée)
--     ↓
--   canonical_subject_link_evidence (preuves, une par occurrence source)
--
-- P0-B2 (futur) : PDF → canonical_subject_occurrence avec source_kind='pdf', même chemin.

-- ── TABLE : canonical_subject_links ──────────────────────────────────────────────

CREATE TABLE public.canonical_subject_links (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              UUID         NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,

  source_subject_id    UUID         NOT NULL REFERENCES public.canonical_subject(id),
  target_subject_id    UUID         NOT NULL REFERENCES public.canonical_subject(id),

  -- Unicité de paire normalisée : une seule relation active par paire orientée.
  -- source/target portent la direction retenue ; la contrainte empêche une seconde
  -- interprétation concurrente sur la même paire (A→B et B→A en même temps).
  pair_low_id          UUID GENERATED ALWAYS AS (LEAST(source_subject_id,  target_subject_id)) STORED,
  pair_high_id         UUID GENERATED ALWAYS AS (GREATEST(source_subject_id, target_subject_id)) STORED,
  UNIQUE (site_id, pair_low_id, pair_high_id),

  -- Whitelist V1 stricte ; relates_to rejeté côté serveur avant INSERT
  relation_type        TEXT         NOT NULL
    CHECK (relation_type IN ('requires', 'enables', 'validates', 'causes', 'replaces')),

  -- Cycle de vie
  status               TEXT         NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'confirmed', 'rejected')),

  -- Métriques LLM — informatives, la preuve reste dans link_evidence
  confidence           NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
  justification        TEXT,

  -- Provenance de l'analyse (run d'occurrences ayant déclenché la suggestion)
  evidence_run_id      UUID,

  -- Audit
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by           UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at         TIMESTAMPTZ,
  confirmed_by         UUID         REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT csl_source_target_different CHECK (source_subject_id <> target_subject_id)
);

CREATE INDEX idx_csl_site     ON public.canonical_subject_links(site_id);
CREATE INDEX idx_csl_source   ON public.canonical_subject_links(source_subject_id);
CREATE INDEX idx_csl_target   ON public.canonical_subject_links(target_subject_id);
CREATE INDEX idx_csl_status   ON public.canonical_subject_links(site_id, status);
CREATE INDEX idx_csl_pair     ON public.canonical_subject_links(site_id, pair_low_id, pair_high_id);

-- ── TABLE : canonical_subject_link_evidence ───────────────────────────────────────

CREATE TABLE public.canonical_subject_link_evidence (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id              UUID         NOT NULL
    REFERENCES public.canonical_subject_links(id) ON DELETE CASCADE,

  -- Occurrence source (obligatoire pour les relations terrain ; null uniquement si future
  -- source sans occurrence individuelle, ce qui n'existe pas en V1)
  occurrence_id        UUID         REFERENCES public.canonical_subject_occurrence(id) ON DELETE SET NULL,

  -- Texte traçable — NON NULL, invariant fondamental de P0-B1.
  -- La confiance LLM ne remplace jamais ce champ.
  evidence_text        TEXT         NOT NULL,

  -- Date de l'occurrence source (dénormalisée pour les requêtes chrono)
  observed_at          DATE         NOT NULL,

  -- Provenance optionnelle : si l'occurrence vient d'une proposition terrain
  source_proposal_id   UUID         REFERENCES public.site_knowledge_proposals(id) ON DELETE SET NULL,

  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_csle_link       ON public.canonical_subject_link_evidence(link_id);
CREATE INDEX idx_csle_occurrence ON public.canonical_subject_link_evidence(occurrence_id);

-- ── RLS : canonical_subject_links ─────────────────────────────────────────────────

ALTER TABLE public.canonical_subject_links ENABLE ROW LEVEL SECURITY;

-- Lecture : tout membre de l'organisation
CREATE POLICY "csl_select" ON public.canonical_subject_links FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = canonical_subject_links.site_id
        AND om.user_id = auth.uid()
    )
  );

-- Insertion : le moteur passe par le client admin (bypass RLS).
-- Cette politique couvre les insertions humaines futures.
CREATE POLICY "csl_insert" ON public.canonical_subject_links FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = canonical_subject_links.site_id
        AND om.user_id = auth.uid()
        AND om.role IN ('admin', 'manager', 'chef_equipe')
    )
  );

-- Mise à jour : confirmation / rejet humain
CREATE POLICY "csl_update" ON public.canonical_subject_links FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE s.id = canonical_subject_links.site_id
        AND om.user_id = auth.uid()
        AND om.role IN ('admin', 'manager', 'chef_equipe')
    )
  );

-- ── RLS : canonical_subject_link_evidence ─────────────────────────────────────────

ALTER TABLE public.canonical_subject_link_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "csle_select" ON public.canonical_subject_link_evidence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.canonical_subject_links csl
      JOIN public.sites s ON s.id = csl.site_id
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE csl.id = canonical_subject_link_evidence.link_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "csle_insert" ON public.canonical_subject_link_evidence FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.canonical_subject_links csl
      JOIN public.sites s ON s.id = csl.site_id
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE csl.id = canonical_subject_link_evidence.link_id
        AND om.user_id = auth.uid()
        AND om.role IN ('admin', 'manager', 'chef_equipe')
    )
  );
