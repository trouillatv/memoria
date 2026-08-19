-- 342 — Statut de la construction de mémoire (P1-A, lot UI final).
--
-- Le déclenchement de l'analyse de similarité incrémentale (triggerIncrementalSimilarityAnalysis)
-- tournait jusqu'ici en fire-and-forget sans trace persistée : impossible de savoir
-- si le pipeline a terminé, combien de sujets ont été analysés, ou s'il a échoué.
--
-- Ces colonnes permettent au widget "MemorIA construit la mémoire du chantier"
-- (visite historique importée) de lire un état réel plutôt que de deviner.
--
-- Suit le même pattern que canonical_reconcile_started_at / canonical_reconciled_at
-- (mig 318 + 323) : soft status, pas de verrou distribué, TTL applicatif côté lecture.

ALTER TABLE public.site_reports
  ADD COLUMN IF NOT EXISTS similarity_analysis_started_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS similarity_analysis_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS similarity_analysis_error        TEXT,
  ADD COLUMN IF NOT EXISTS similarity_analysis_subject_count INTEGER;

COMMENT ON COLUMN public.site_reports.similarity_analysis_started_at IS
  'Horodatage du début du pipeline de construction de mémoire (occurrences + analyse de similarité) pour cette visite historique (mig 342). NULL = jamais déclenché.';

COMMENT ON COLUMN public.site_reports.similarity_analysis_completed_at IS
  'Horodatage de la dernière exécution terminée (succès) du pipeline de construction de mémoire (mig 342). NULL = en cours, jamais terminé, ou en échec.';

COMMENT ON COLUMN public.site_reports.similarity_analysis_error IS
  'Message d''erreur de la dernière exécution échouée du pipeline de construction de mémoire (mig 342). NULL si succès ou jamais exécuté. Détail technique réservé aux logs/admin — jamais affiché tel quel à l''utilisateur.';

COMMENT ON COLUMN public.site_reports.similarity_analysis_subject_count IS
  'Nombre de sujets métier candidats considérés lors de la dernière analyse de similarité réussie (mig 342). Utilisé par le widget de statut ("N sujets métier analysés").';
