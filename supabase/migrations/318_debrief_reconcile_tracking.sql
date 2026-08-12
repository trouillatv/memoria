-- 318 — Tracking de la réconciliation canonique sur site_reports.
--
-- Objectif : distinguer les deux étapes de traitement post-debrief et rendre
-- chacune observable et rejouable indépendamment :
--
--   Étape 1 — Projection : debrief_projected_at / debrief_projection_error (mig 213)
--   Étape 2 — Réconciliation : canonical_reconciled_at / canonical_reconcile_error (mig 318)
--
-- Invariant : une visite dont canonical_reconciled_at IS NULL n'a pas encore
-- contribué à la mémoire canonique du chantier et doit être repassée.
--
-- Rollback : ALTER TABLE DROP COLUMN canonical_reconciled_at, canonical_reconcile_error.

ALTER TABLE public.site_reports
  ADD COLUMN IF NOT EXISTS canonical_reconciled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS canonical_reconcile_error text;

COMMENT ON COLUMN public.site_reports.canonical_reconciled_at IS
  'Horodatage de la dernière réconciliation canonique réussie (mig 318). NULL = jamais effectuée ou en échec.';

COMMENT ON COLUMN public.site_reports.canonical_reconcile_error IS
  'Erreur JSON sérialisée de la dernière réconciliation canonique échouée (mig 318). NULL si succès.';

CREATE INDEX IF NOT EXISTS idx_site_reports_canonical_reconciled
  ON public.site_reports (site_id, canonical_reconciled_at)
  WHERE canonical_reconciled_at IS NULL;
