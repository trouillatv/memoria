-- Migration 381 : dimension evidence_directness sur le candidat de complétion (P1-4B policy V2.2)
--
-- Le gate de robustesse HIGH (5× READ-ONLY, RUS) a montré que la frontière HIGH pouvait, à faible
-- probabilité, laisser passer une correspondance INFÉRÉE (raisonnement causal implicite : « Ensemble
-- DAI remplacé » ⇒ « solution pour le changement de type de détecteur DAI »). V2.2 introduit une
-- 3e dimension de jugement — evidence_directness — et exige "direct" pour HIGH : une inférence
-- implicite ne peut plus déclencher d'auto-clôture. Le gate 5× a prouvé cette dimension STABLE
-- (positifs directs 5/5 direct+HIGH ; DAI 5/5 inferred+MEDIUM ; adversariaux 0/5 HIGH).
--
-- Additif et rétro-compatible :
--   - Colonne NULLABLE : les candidats V2/V2.1 déjà persistés n'ont jamais produit cette dimension
--     et restent parfaitement lisibles avec evidence_directness IS NULL. AUCUN backfill artificiel.
--   - Seuls les jugements V2.2 (et suivants) renseignent 'direct'/'inferred'.
--   - Aucune modification des tables/décisions existantes, aucun signal, aucun lien loadCboEvolutions.

ALTER TABLE public.document_completion_candidate
  ADD COLUMN IF NOT EXISTS evidence_directness TEXT
    CHECK (evidence_directness IS NULL OR evidence_directness IN ('direct', 'inferred'));
