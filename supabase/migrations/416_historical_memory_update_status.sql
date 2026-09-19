-- 416 — Statut end-to-end de la mise à jour mémoire d'un PV historique.
--
-- Les migrations précédentes rendaient observables la réconciliation canonique
-- (318), la similarité (342) et les erreurs Action-CBO (413), mais pas le succès
-- Action-CBO ni les deux dernières étapes du post-processing historique
-- (Live Writer Points et résolution documentaire). L'UI pouvait donc afficher
-- "Mémoire à jour" alors que la fin de chaîne n'avait aucune preuve durable.

ALTER TABLE public.site_reports
  ADD COLUMN IF NOT EXISTS action_cbo_reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracked_point_live_writer_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracked_point_live_writer_error text,
  ADD COLUMN IF NOT EXISTS document_completion_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS document_completion_error text;

COMMENT ON COLUMN public.site_reports.action_cbo_reconciled_at IS
  'Dernière réconciliation réussie des Actions par CBO pour ce rapport historique.';
COMMENT ON COLUMN public.site_reports.tracked_point_live_writer_completed_at IS
  'Dernier passage réussi du Live Writer Points pour ce rapport historique.';
COMMENT ON COLUMN public.site_reports.tracked_point_live_writer_error IS
  'Erreur du dernier passage Live Writer Points pour ce rapport historique, NULL si le dernier passage a réussi.';
COMMENT ON COLUMN public.site_reports.document_completion_resolved_at IS
  'Dernier passage réussi du résolveur de complétion documentaire proposal-level.';
COMMENT ON COLUMN public.site_reports.document_completion_error IS
  'Erreur du dernier passage du résolveur de complétion documentaire proposal-level, NULL si le dernier passage a réussi.';

-- Rattrapage d'observabilité : avant cette migration, Live Writer et completion
-- resolver étaient best-effort et non persistés. Pour les imports historiques que
-- la base considérait déjà terminés sans erreur persistée, on initialise les
-- nouveaux jalons sur la fin du pipeline de similarité afin d'éviter un état
-- "en cours" éternel sur des PV legacy.
UPDATE public.site_reports
SET
  action_cbo_reconciled_at = COALESCE(action_cbo_reconciled_at, similarity_analysis_completed_at),
  tracked_point_live_writer_completed_at = COALESCE(tracked_point_live_writer_completed_at, similarity_analysis_completed_at),
  tracked_point_live_writer_error = NULL,
  document_completion_resolved_at = COALESCE(document_completion_resolved_at, similarity_analysis_completed_at),
  document_completion_error = NULL
WHERE origin = 'import'
  AND extraction_run_id IS NOT NULL
  AND canonical_reconciled_at IS NOT NULL
  AND canonical_reconcile_error IS NULL
  AND similarity_analysis_completed_at IS NOT NULL
  AND similarity_analysis_error IS NULL
  AND action_cbo_reconcile_error IS NULL;
