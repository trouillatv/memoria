-- Migration 071 : V6.1 — l'heure honnête de la prestation
--
-- Constat fondateur (exploitation-doctrine-V6.md, audit 2026-05-18) :
-- `interventions.scheduled_at` était dérivé par des mappings slot→heure
-- divergents (6/12/18 ; 7/13/18 ; 8/14/19). Le système stockait une fausse
-- heure précise, incohérente selon le chemin de code.
--
-- V6.1 introduit `planned_start` / `planned_end` : le champ honnête de la
-- prestation. `slot` redevient un label grossier dérivé (cf. module canonique
-- lib/time/prestation-slot.ts).
--
-- STRATÉGIE ADDITIVE NON DESTRUCTIVE (arbitrage Vincent, 2026-05-19) :
--   - colonnes NULLABLE, aucune contrainte rétroactive ;
--   - backfill `planned_start = scheduled_at` TEL QUEL — on ne réécrit AUCUN
--     timestamp historique (même incohérent). Le reverse canonique tolérant
--     (`slot = f(heure)`, bornes h<12 / h<17) relit ces legacy au bon slot ;
--   - `planned_end` reste NULL : pas de source de durée fiable aujourd'hui
--     (V6.1 « planned_duration » = tranche ultérieure, hors périmètre).
--
-- Doctrine : `planned_*` est un ancrage de prestation (site/contrat), JAMAIS
-- un pointage de personne (pare-feu V6.1). Ne jamais agréger par user_id.

ALTER TABLE public.interventions
  ADD COLUMN IF NOT EXISTS planned_start timestamptz,
  ADD COLUMN IF NOT EXISTS planned_end   timestamptz;

-- Backfill non destructif : l'existant reçoit son scheduled_at inchangé.
UPDATE public.interventions
  SET planned_start = scheduled_at
  WHERE planned_start IS NULL;

COMMENT ON COLUMN public.interventions.planned_start IS
  'V6.1 — heure honnête de la prestation (ancrage canonique slot→heure). '
  'Label grossier, jamais un horaire jugé. Backfill = scheduled_at legacy.';
COMMENT ON COLUMN public.interventions.planned_end IS
  'V6.1 — fin planifiée de la prestation. NULL tant que planned_duration '
  'n''est pas une tranche livrée. Jamais agrégé par personne (pare-feu V6.1).';
