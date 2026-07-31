-- 268 — Lot 1 : identité temporelle des objets
--
-- Chaque proposition appartient désormais à un "subject_thread" :
-- un fil thématique stable qui traverse plusieurs PV successifs sur le même chantier.
-- Ce fil permet de calculer les transitions d'état entre comptes-rendus
-- de manière déterministe, sans relire les PDF.
--
-- Deux colonnes ajoutées à document_extraction_proposal :
--   • subject_thread_id — UUID partagé entre toutes les propositions
--     qui référencent le même sujet dans des runs distincts.
--     Calculé par lib/documents/subject-reconciliation.ts après chaque extraction.
--   • document_status — état normalisé de l'objet à la date du document.
--     Normalisé en aval du champ source_payload.statusAtDocumentDate.
--     Valeurs : planned / open / in_progress / done / non_compliant /
--               awaiting_validation / cancelled / informational

ALTER TABLE public.document_extraction_proposal
  ADD COLUMN IF NOT EXISTS subject_thread_id UUID,
  ADD COLUMN IF NOT EXISTS document_status TEXT
    CHECK (document_status IN (
      'planned', 'open', 'in_progress', 'done',
      'non_compliant', 'awaiting_validation', 'cancelled', 'informational'
    ));

-- Index principal : retrouver tous les états d'un fil pour un chantier donné
CREATE INDEX IF NOT EXISTS dep_subject_thread_site_idx
  ON public.document_extraction_proposal (target_site_id, subject_thread_id)
  WHERE subject_thread_id IS NOT NULL;

-- Index secondaire : retrouver toutes les propositions d'un fil (toutes origines)
CREATE INDEX IF NOT EXISTS dep_subject_thread_idx
  ON public.document_extraction_proposal (subject_thread_id)
  WHERE subject_thread_id IS NOT NULL;

-- Backfill document_status depuis source_payload.statusAtDocumentDate (texte libre → enum).
-- Ne couvre pas les familles 'person' et 'company' (attendance, pas document_status).
--
-- Ordre : du plus spécifique au plus général pour éviter les collisions.
-- Ex. 'non démarré' doit → planned avant que '%démarré%' → in_progress.
--     'VISA en cours' doit → awaiting_validation avant que '%en cours%' → in_progress.
--     'partiellement réalisé' doit → in_progress avant que '%réalis%' → done.
UPDATE public.document_extraction_proposal
SET document_status = CASE
  WHEN source_payload->>'statusAtDocumentDate' IS NULL
    OR source_payload->>'statusAtDocumentDate' = ''
    THEN NULL
  WHEN source_payload->>'statusAtDocumentDate' ILIKE '%non conform%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%refusé%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%hors tolérance%'
    THEN 'non_compliant'
  WHEN source_payload->>'statusAtDocumentDate' ILIKE '%non démarré%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%non commencé%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%prévu%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%planifié%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%programmé%'
    THEN 'planned'
  WHEN source_payload->>'statusAtDocumentDate' ILIKE '%en attente%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%attendu%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%visa%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%validation%'
    THEN 'awaiting_validation'
  WHEN source_payload->>'statusAtDocumentDate' ILIKE '%annulé%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%abandonné%'
    THEN 'cancelled'
  WHEN source_payload->>'statusAtDocumentDate' ILIKE '%en cours%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%partiellement%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%démarré%'
    THEN 'in_progress'
  WHEN source_payload->>'statusAtDocumentDate' ILIKE '%réalis%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%termin%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%levé%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%exécut%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%accompli%'
    OR lower(source_payload->>'statusAtDocumentDate') = 'fait'
    THEN 'done'
  WHEN source_payload->>'statusAtDocumentDate' ILIKE '%ouvert%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%signalé%'
    OR source_payload->>'statusAtDocumentDate' ILIKE '%constaté%'
    THEN 'open'
  ELSE 'informational'
END
WHERE document_status IS NULL
  AND proposal_family NOT IN ('person', 'company');
