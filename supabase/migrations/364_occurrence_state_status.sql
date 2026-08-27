-- Migration 364 : R-1 — tri-state longitudinal de l'occurrence (state_status)
--
-- Convergence R-1 : canonical_subject_occurrence doit être la source longitudinale SUFFISANTE pour
-- reconstruire la trajectoire d'un sujet. Le tri-state resolved/open/unknown était jusqu'ici dérivé de
-- document_status côté propositions ; on le porte désormais sur l'occurrence, établi AU MOMENT de
-- l'extraction, au niveau du groupe state_key (un état = une occurrence).
--
-- Contrat (deriveOccurrenceStateStatus) :
--   - propositions du groupe univoques (que resolved OU que open) → ce tri-state ;
--   - statuts incompatibles dans le groupe (resolved ET open)      → 'unknown' (conflit, jamais masqué
--     par une priorité open>resolved ou resolved>open) ;
--   - aucun signal exploitable (tout null)                          → 'unknown' (missing).
-- 'unknown' couvre donc deux situations (missing / conflicting) ; la distinction reste au diagnostic
-- (logs/audits), sans colonne dédiée pour l'instant.
--
-- Additif et sûr : nullable. NULL est réservé au LEGACY non encore backfillé pendant la transition ;
-- toute occurrence écrite/rematérialisée par le workflow porte une valeur du domaine fermé.

ALTER TABLE public.canonical_subject_occurrence
  ADD COLUMN IF NOT EXISTS state_status TEXT
  CHECK (state_status IN ('resolved', 'open', 'unknown'));

COMMENT ON COLUMN public.canonical_subject_occurrence.state_status IS
  'R-1 — tri-state longitudinal de l''état (resolved|open|unknown), calculé au niveau du groupe '
  'state_key à l''extraction. Conflit interne (resolved ET open) → unknown, jamais masqué. NULL = '
  'legacy non backfillé (transitoire). Remplace la dérivation depuis document_status côté propositions.';
