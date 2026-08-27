-- Migration 362 : P3-D1 — multiplicité atomique des occurrences (state_key)
--
-- Audit P3-C : canonical_subject_occurrence est créée comme « présence documentaire » (1 par
-- (sujet, rapport)) mais consommée comme « suite d'états datés ». Un même sujet peut légitimement
-- porter plusieurs états/événements distincts dans un même document (ex. « contrôle réalisé le
-- 22/03/2024 » + « à refaire au 05/08/2025 »). L'index unique (subject, report) l'interdit.
--
-- D1 : on AFFINE la clé d'unicité (jamais on ne la supprime). state_key = discriminateur d'état
-- déterministe (D1 = proposal_family). Un état distinct = une occurrence ; les reformulations d'un
-- même état restent poolées (dédup same-state, cf. lib/db/occurrence-state-key.ts).
--
-- Additif et sûr pour l'existant : state_key nullable ; les occurrences legacy (une seule par
-- (subject, report)) gardent state_key = NULL. NULLS NOT DISTINCT garantit qu'il ne peut y avoir
-- qu'UNE ligne legacy (null) par (subject, report), exactement comme l'ancienne contrainte, tout en
-- autorisant des lignes atomiques (state_key non null) à coexister. Pas de backfill ici (mandat
-- Vincent : D1 = workflow futur + migration + tests + dry-run ; backfill massif = lot A séparé).

ALTER TABLE public.canonical_subject_occurrence
  ADD COLUMN IF NOT EXISTS state_key TEXT;

COMMENT ON COLUMN public.canonical_subject_occurrence.state_key IS
  'P3-D1 — discriminateur d''état atomique (D1 = proposal_family). NULL = occurrence legacy '
  '(pré-D1, une par (sujet, rapport)). Partie de la clé d''unicité du canal historique.';

-- Remplacer l'index unique (subject, report) par (subject, report, state_key).
DROP INDEX IF EXISTS cso_historical_pdf_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS cso_historical_pdf_uniq
  ON public.canonical_subject_occurrence (canonical_subject_id, source_ref_id, state_key)
  NULLS NOT DISTINCT
  WHERE source_kind = 'historical_pdf';

COMMENT ON INDEX cso_historical_pdf_uniq IS
  'P3-D1 — une occurrence par (canonical_subject, rapport_historique, state_key). Permet N états '
  'atomiques distincts d''un sujet dans un même document, tout en préservant l''idempotence '
  '(rejeu identique → mêmes state_key → aucun doublon). NULLS NOT DISTINCT : au plus une ligne '
  'legacy (state_key=NULL) par (subject, report), comme l''ancienne contrainte.';
