-- Migration 377 — E3 : backfill CORRECTIF ciblé de state_status sur occurrences
-- historiques, par re-normalisation depuis le verdict BRUT (doctrine E1→E2).
--
-- Mesuré par le dry-run FIDÈLE (mode no-write du vrai dérivateur
-- ensureHistoricalPdfOccurrences) : 621/621 occurrences historiques ré-appariées,
-- exactement 3 divergences stored ≠ recalcul. Impact métier certifié : 1 sujet
-- change d'état courant (026bc12a : « conforme » seul ne prouve pas une clôture),
-- 1 LMCA, aucune vague de réouverture/aggravation.
--
-- PÉRIMÈTRE STRICT (E3) :
--   · UPDATE UNIQUEMENT des 3 occurrences EXISTANTES ; invariant 621 → 621.
--   · Chaque UPDATE est GARDÉ par l'ancien état attendu (anti-écrasement
--     concurrent : si l'état a changé depuis le dry-run, 0 ligne, pas d'écrasement).
--   · AUCUN INSERT/DELETE. Ne crée PAS les 228 groupes désormais éligibles
--     (dérive de la doctrine d'éligibilité depuis l'import = autre sujet, hors E3).
--   · Ne touche PAS document_status (verdict brut conservé). Aucun E4/F.
--   · Idempotent ; sûr sur autre environnement (ids absents → 0 ligne).
--
-- Contrôle de convergence post-écriture : dry-run fidèle rejoué → 0 divergence.

-- « non applicable » : not_applicable → unknown (NA ne prouve pas une résolution)
UPDATE public.canonical_subject_occurrence
   SET state_status = 'unknown', updated_at = now()
 WHERE id = 'f892d422-dd38-4e87-b048-bd7278556f3a' AND state_status = 'resolved';

-- « conforme » seul : compliant_positive → unknown (conforme ≠ clôture, doctrine E2)
UPDATE public.canonical_subject_occurrence
   SET state_status = 'unknown', updated_at = now()
 WHERE id = 'ef62fa63-c886-4f37-ae76-48d2df843c05' AND state_status = 'resolved';

-- « à réaliser » (planned→open) : le groupe devient open (tâche non soldée)
UPDATE public.canonical_subject_occurrence
   SET state_status = 'open', updated_at = now()
 WHERE id = '8f2d43e2-cb90-49b5-82c5-d06a2b64d196' AND state_status = 'unknown';
