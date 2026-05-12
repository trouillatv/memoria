-- Mémoire décisionnelle AO — Sprint 1 doctrine V5
-- 3 champs : statut sortie, raison libre, tag thématique
-- Doctrine V1 : mémoire ≠ recommandation. Aucun champ "score" ni "next_action".

CREATE TYPE public.tender_outcome AS ENUM (
  'pending',          -- en attente de réponse client (default après submitted)
  'won',              -- contrat gagné
  'lost',             -- perdu (un autre prestataire)
  'withdrawn',        -- on a retiré notre proposition
  'not_responded'     -- le client n'a jamais répondu
);

CREATE TYPE public.tender_outcome_tag AS ENUM (
  'prix',
  'qualite',
  'relation',
  'timing',
  'autre'
);

ALTER TABLE public.tenders
  ADD COLUMN outcome public.tender_outcome,
  ADD COLUMN outcome_at timestamptz,
  ADD COLUMN outcome_reason text,
  ADD COLUMN outcome_tag public.tender_outcome_tag,
  ADD COLUMN outcome_set_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_outcome_reason_length
    CHECK (outcome_reason IS NULL OR char_length(outcome_reason) <= 200),
  ADD CONSTRAINT chk_outcome_coherence
    CHECK (
      (outcome IS NULL AND outcome_at IS NULL AND outcome_reason IS NULL AND outcome_tag IS NULL)
      OR
      (outcome IS NOT NULL)
    );

CREATE INDEX idx_tenders_outcome
  ON public.tenders(outcome)
  WHERE outcome IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN public.tenders.outcome IS
  'Doctrine V5 mémoire commerciale : statut sortie. NULL = pas encore renseigné. pending = soumis en attente. won/lost/withdrawn/not_responded = finalisé.';
COMMENT ON COLUMN public.tenders.outcome_tag IS
  'Tag thématique enum strict (prix/qualite/relation/timing/autre). PAS un score. PAS un classement.';
