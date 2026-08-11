-- 314_site_decisions_orphan.sql
--
-- Étend site_decisions avec les colonnes d'orphelinage,
-- symétriques à site_actions et site_reserve.
--
-- Ces colonnes permettent à reconcileObsoleteProposals() de tracer
-- les décisions dont la source a été supersédée sans remplacement,
-- sans les supprimer (préservation de la trace d'audit).

ALTER TABLE public.site_decisions
  ADD COLUMN IF NOT EXISTS orphaned_from_visit_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS orphaned_from_visit_reason   TEXT;

CREATE INDEX IF NOT EXISTS idx_site_decisions_orphan
  ON public.site_decisions(site_id, orphaned_from_visit_at)
  WHERE orphaned_from_visit_at IS NOT NULL;
