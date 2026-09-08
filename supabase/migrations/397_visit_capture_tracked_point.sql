-- Migration 397 : visit_capture.tracked_point_id (Point Verify Contract)
--
-- Le panier mobile "Vérifier" doit pouvoir viser un tracked_point (mig 388),
-- pas seulement un subjects legacy (mig 124/165) : audit MOBILE VERIFY TRUTH
-- a montré que subject_id est structurellement vide sur les chantiers qui
-- utilisent déjà tracked_point (RUS Dumbéa Mall, OCEF), rendant "Vérifier"
-- mort alors que la situation à vérifier existe déjà comme Point.
--
-- Additive, nullable, ON DELETE SET NULL (même contrat que subject_id, mig
-- 165 L.67). subject_id N'EST PAS touché : les captures historiques gardent
-- leur rattachement subject_id ; les nouvelles captures 'verification' visent
-- tracked_point_id uniquement. Jamais d'écriture double (pas de dual-write) :
-- le garde-fou XOR vit côté application (capture-actions.ts), pas en CHECK
-- SQL, pour ne pas casser les captures 'note'/'position' qui n'ont ni l'un
-- ni l'autre.

ALTER TABLE public.visit_capture
  ADD COLUMN tracked_point_id UUID REFERENCES public.tracked_point(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS visit_capture_tracked_point_idx
  ON public.visit_capture (tracked_point_id) WHERE tracked_point_id IS NOT NULL;
