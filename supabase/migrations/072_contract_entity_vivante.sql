-- Migration 072 : V6.3 — le contrat comme entité vivante (tranche 1, schéma)
--
-- Doctrine : exploitation-doctrine-V6.md, Pilier V6.3.
--   « ~80 % = agrégation d'existant (chaîne engagement → mission →
--     intervention → preuve déjà codée), pas création. »
--
-- Investigation : end_date (date fin), tender_id (AO lié), engagements
-- (= prestations du contrat, déjà liées via contract_id), getEvidenceFor
-- Engagement (= consommé/historique) EXISTENT déjà. Les SEULS manques
-- réellement non agrégeables sont deux attributs du contrat :
--
--   - volume_horaire_mensuel : heures PRÉVUES/mois (cible du contrat).
--   - frequence              : rythme contractuel (libellé libre).
--
-- STRATÉGIE ADDITIVE NON DESTRUCTIVE (discipline migration 071) : colonnes
-- NULLABLE, aucune contrainte rétroactive, aucun backfill destructif.
--
-- Doctrine : ces attributs sont des propriétés DU CONTRAT (entité non
-- humaine, test V2 passe). volume_horaire_mensuel est une cible du contrat,
-- JAMAIS agrégée par personne (pare-feu V6.1). Les documents du contrat et
-- l'UI = tranches ultérieures.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS volume_horaire_mensuel numeric,
  ADD COLUMN IF NOT EXISTS frequence text;

COMMENT ON COLUMN public.contracts.volume_horaire_mensuel IS
  'V6.3 — heures de prestation PRÉVUES par mois (cible du contrat). '
  'Comparé au consommé dérivé (chaîne engagement→intervention→preuve). '
  'Jamais agrégé par personne (pare-feu V6.1).';
COMMENT ON COLUMN public.contracts.frequence IS
  'V6.3 — rythme contractuel (libellé libre, ex. « hebdomadaire »).';
