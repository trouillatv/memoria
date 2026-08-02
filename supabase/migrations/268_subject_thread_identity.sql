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

-- Backfill supprimé : voir migration 271 pour le backfill sans unaccent()
-- (conserve la définition de colonnes et index ci-dessus)
