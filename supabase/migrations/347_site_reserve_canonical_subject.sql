-- P1-C2B.2 — combler l'asymétrie de rattachement canonique sur site_reserve.
--
-- site_actions et site_deadlines portent déjà canonical_subject_id (migration 346),
-- alimenté best-effort par resolveCanonicalSubjectReference() lors de la création
-- (Copilote / manuel / debrief). site_reserve n'a jamais eu cette colonne : son seul
-- rattachement au sujet canonique passe par la chaîne historique
-- document_proposal_materialization → document_extraction_proposal → subject_thread_identity,
-- absente pour les réserves créées hors import PV.
--
-- Additive uniquement, même pattern que 346 : colonne nullable + index partiel.
-- Aucun backfill : les réserves existantes restent NULL tant qu'un resolver ne les
-- rattache pas explicitement (P1-C2B.2, branchement live dans createSiteReserve()).

ALTER TABLE public.site_reserve
  ADD COLUMN IF NOT EXISTS canonical_subject_id UUID REFERENCES canonical_subject(id);

CREATE INDEX IF NOT EXISTS site_reserve_canonical_site_idx
  ON public.site_reserve (site_id, canonical_subject_id)
  WHERE canonical_subject_id IS NOT NULL;

COMMENT ON COLUMN public.site_reserve.canonical_subject_id IS
  'Rattachement direct au sujet canonique, alimenté best-effort à la création (createSiteReserve). '
  'NULL = non résolu ou réserve issue d''un import PV historique (fallback : chaîne document_proposal_materialization).';
