-- Migration 363 : P3-D2 — date propre de l'événement (distincte de la date du document)
--
-- Audit P3-C/D2 : effective_date d'une occurrence historique vaut TOUJOURS la date du PV. Or un PV
-- récent peut rappeler un fait daté antérieur (« contrôle réalisé le 22/03/2024 » dans le PV du
-- 05/08/2025). On ajoute une date ÉVÉNEMENTIELLE distincte, sans surcharger effective_date (qui reste
-- la date documentaire, consommée par lastSeenAt).
--
-- Contrat : event_date = date propre du fait quand elle est fiablement extraite (sémantique
-- event_date, brique déterministe detect-document-date/event-date) ; NULL sinon (jamais recopier la
-- date du PV). event_date NE fait PAS partie de la clé d'unicité (state_key reste l'identité de
-- l'état ; deux états peuvent partager une date ; une correction de date ne crée pas de doublon).
--
-- Additif et sûr : nullable, aucun backfill (mandat D2 = colonne + workflow + tests + dry-run).

ALTER TABLE public.canonical_subject_occurrence
  ADD COLUMN IF NOT EXISTS event_date DATE;

COMMENT ON COLUMN public.canonical_subject_occurrence.event_date IS
  'P3-D2 — date propre de l''événement/état (ISO), distincte de effective_date (date du document). '
  'NULL si aucune date événementielle fiable. Position temporelle longitudinale = '
  'COALESCE(event_date, effective_date). effective_date reste la date documentaire (lastSeenAt). '
  'Hors clé d''unicité (identité de l''état = state_key).';

-- Index pour l'ordre chronologique événementiel des lignes de vie.
CREATE INDEX IF NOT EXISTS idx_cso_event_date
  ON public.canonical_subject_occurrence (canonical_subject_id, event_date);
