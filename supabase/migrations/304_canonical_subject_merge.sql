-- Migration 304 : canonical_subject_merge
--
-- Journal de fusion réversible des canonical_subject.
-- Quand deux sujets sont identifiés comme le même fil métier, le loser est
-- rattaché au winner via merged_into, ses threads/occurrences sont reroutés,
-- et cette table trace l'opération pour permettre un --undo précis.
--
-- Invariant : un loser ne peut être fusionné qu'une seule fois (UNIQUE loser_subject_id).
-- Pour défaire une fusion : utiliser le snapshot.moved_thread_ids, moved_occurrence_ids,
-- winner_label_before et winner_aliases_before.

CREATE TABLE public.canonical_subject_merge (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  winner_subject_id UUID        NOT NULL REFERENCES public.canonical_subject(id),
  loser_subject_id  UUID        NOT NULL REFERENCES public.canonical_subject(id),
  suggested_label   TEXT,       -- libellé canonique proposé par LLM pour le winner
  resolution_source TEXT        NOT NULL DEFAULT 'llm'
    CHECK (resolution_source IN ('llm', 'manual')),
  llm_confidence    NUMERIC(4,3),
  llm_reasoning     TEXT,
  snapshot          JSONB,
  -- snapshot contient :
  --   moved_thread_ids       : UUID[] des subject_thread_identity déplacés
  --   moved_occurrence_ids   : UUID[] des canonical_subject_occurrence reroutés
  --   winner_label_before    : TEXT label du winner avant fusion
  --   winner_aliases_before  : TEXT[] aliases du winner avant fusion
  --   loser_label            : TEXT label du loser
  --   loser_aliases          : TEXT[] aliases du loser
  merged_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (loser_subject_id)   -- un loser ne peut être fusionné qu'une fois
);

CREATE INDEX ON public.canonical_subject_merge (winner_subject_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.canonical_subject_merge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view canonical_subject_merge"
  ON public.canonical_subject_merge FOR SELECT
  USING (
    winner_subject_id IN (
      SELECT cs.id FROM public.canonical_subject cs
      JOIN public.sites s ON s.id = cs.site_id
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "service role manages canonical_subject_merge"
  ON public.canonical_subject_merge FOR ALL
  USING (auth.role() = 'service_role');
