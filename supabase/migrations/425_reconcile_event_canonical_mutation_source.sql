-- P0-A (mandat Vincent, root cause "mutation canonique tardive non signalée") — élargit le
-- CHECK source_kind de tracked_point_reconcile_event (migration 400) pour couvrir la
-- réévaluation d'un thread déclenchée par une mutation CBO (attachToCanonicalBusinessObject),
-- distincte des provenances existantes (historical_pdf/field_visit/meeting).
--
-- Additif : aucune ligne existante modifiée (le CHECK est élargi, jamais réduit).

ALTER TABLE public.tracked_point_reconcile_event DROP CONSTRAINT IF EXISTS tracked_point_reconcile_event_source_kind_check;
ALTER TABLE public.tracked_point_reconcile_event ADD CONSTRAINT tracked_point_reconcile_event_source_kind_check
  CHECK (source_kind IN ('historical_pdf', 'field_visit', 'meeting', 'canonical_mutation'));
