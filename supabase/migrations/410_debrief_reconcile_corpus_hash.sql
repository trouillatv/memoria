-- 410 — Empreinte de contenu pour la réconciliation canonique (P0-1B).
--
-- Objectif : `canonical_reconciled_at` (mig 318) n'est qu'un booléen — sa seule
-- présence bloque tout rejeu, même après une réédition du CR (force-regénération,
-- ou abandon d'une capture/vocal qui régénère l'analyse). La canonicalisation ne
-- reflète alors jamais une correction de contenu ultérieure au premier passage.
--
-- `canonical_reconciled_corpus_hash` mémorise le `corpus_hash` (déjà calculé et
-- stocké dans `debrief_analysis`, cf. computeCorpusHash) qui a produit la
-- dernière réconciliation réussie. `decideReconcileLock` compare ce hash à celui
-- de l'analyse courante : contenu identique → idempotence conservée (comportement
-- 318 inchangé) ; contenu différent → rejeu autorisé, jamais forcé pour la voie
-- historique (paramètre optionnel, absent = comportement 318 strict).
--
-- Rollback : ALTER TABLE DROP COLUMN canonical_reconciled_corpus_hash.

ALTER TABLE public.site_reports
  ADD COLUMN IF NOT EXISTS canonical_reconciled_corpus_hash text;

COMMENT ON COLUMN public.site_reports.canonical_reconciled_corpus_hash IS
  'corpus_hash (debrief_analysis) au moment de la dernière réconciliation canonique réussie (mig 410, P0-1B). NULL = jamais réconcilié, ou réconcilié avant ce lot. Permet à decideReconcileLock de rejouer uniquement quand le contenu métier a réellement changé.';
