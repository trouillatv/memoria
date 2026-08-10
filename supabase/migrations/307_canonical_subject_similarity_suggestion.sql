-- 307 : canonical_subject_similarity_suggestion
--
-- Persiste les suggestions de rapprochement IA entre canonical_subject.
-- Générées par batch (scripts/analyze-subject-similarities.ts), consultées
-- dans la matrice "Rapprochements IA", réutilisées au DnD.
--
-- Une paire est normalisée : subject_a_id = least(), subject_b_id = greatest()
-- pour éviter les doublons (A,B) et (B,A).

CREATE TABLE public.canonical_subject_similarity_suggestion (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  subject_a_id         UUID NOT NULL REFERENCES public.canonical_subject(id) ON DELETE CASCADE,
  subject_b_id         UUID NOT NULL REFERENCES public.canonical_subject(id) ON DELETE CASCADE,

  -- Résultat IA
  score                INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  verdict              TEXT NOT NULL
    CHECK (verdict IN ('same_subject', 'related', 'distinct', 'uncertain')),
  recommendation       TEXT NOT NULL
    CHECK (recommendation IN ('merge', 'link', 'none')),
  suggested_link_type  TEXT
    CHECK (suggested_link_type IN ('requires', 'enables', 'causes', 'validates', 'replaces', 'relates_to')),
  suggested_direction  TEXT
    CHECK (suggested_direction IN ('a_to_b', 'b_to_a')),
  suggested_label      TEXT,
  reason               TEXT NOT NULL,
  model                TEXT NOT NULL,
  analyzed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Décision humaine
  status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted_merge', 'accepted_link', 'rejected', 'obsolete')),
  reviewed_at          TIMESTAMPTZ,
  reviewed_by          UUID REFERENCES auth.users(id),

  -- Paire normalisée : unicité garantie
  CONSTRAINT canonical_subject_similarity_suggestion_pair_unique
    UNIQUE (subject_a_id, subject_b_id),

  -- Ordre canonique : subject_a_id doit être le least() des deux UUIDs
  CONSTRAINT canonical_subject_similarity_suggestion_pair_ordered
    CHECK (subject_a_id < subject_b_id)
);

CREATE INDEX ON public.canonical_subject_similarity_suggestion (site_id, status);
CREATE INDEX ON public.canonical_subject_similarity_suggestion (subject_a_id);
CREATE INDEX ON public.canonical_subject_similarity_suggestion (subject_b_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.canonical_subject_similarity_suggestion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view similarity suggestions"
  ON public.canonical_subject_similarity_suggestion FOR SELECT
  USING (
    site_id IN (
      SELECT s.id FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "org members can update similarity suggestions"
  ON public.canonical_subject_similarity_suggestion FOR UPDATE
  USING (
    site_id IN (
      SELECT s.id FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "service role manages similarity suggestions"
  ON public.canonical_subject_similarity_suggestion FOR ALL
  USING (auth.role() = 'service_role');
