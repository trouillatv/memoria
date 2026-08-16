-- 324_copilot_journal_extended.sql
-- Brique 2 (mandat Vincent 2026-08-17) : le journal Copilote existant
-- (copilot_interactions, mig 294+296) devient l'"Audit MemorIA / Questions &
-- apprentissages" — pas de second système. Cette migration ajoute ce qui
-- manquait pour fermer la boucle question → réponse → cause → correction :
--   - la transcription BRUTE (avant normalisation lexicale) et les
--     corrections appliquées, pour auditer le STT lui-même ;
--   - un retour humain explicite (pouce haut/bas + commentaire libre) ;
--   - une classification de cause pour toute réponse jugée insatisfaisante,
--     posée par un humain pour l'instant (brique 3 = proposition LLM future,
--     jamais écriture directe en mémoire canonique).
--
-- Toutes nullable, toutes mutables après insert (même précédent que
-- proposal_status/reference_clicks) : les interactions déjà enregistrées ne
-- changent pas de forme.

ALTER TABLE copilot_interactions
  ADD COLUMN IF NOT EXISTS transcription_raw          text,
  ADD COLUMN IF NOT EXISTS transcription_corrections  jsonb,
  ADD COLUMN IF NOT EXISTS feedback_rating            text,
  ADD COLUMN IF NOT EXISTS feedback_comment           text,
  ADD COLUMN IF NOT EXISTS cause_diagnostic           text;

ALTER TABLE copilot_interactions
  ADD CONSTRAINT copilot_interactions_feedback_rating_check
    CHECK (feedback_rating IS NULL OR feedback_rating IN ('up', 'down'));

ALTER TABLE copilot_interactions
  ADD CONSTRAINT copilot_interactions_cause_diagnostic_check
    CHECK (cause_diagnostic IS NULL OR cause_diagnostic IN (
      'correct',              -- réponse jugée correcte et complète
      'incomplete',           -- réponse partielle, il manquait un élément
      'bad_data',             -- la donnée récupérée elle-même était fausse/périmée
      'missing_relation',     -- la donnée existait mais la relation n'était pas matérialisée
      'bad_routing',          -- mauvaise classification/scope, mauvaise question comprise
      'missing_knowledge',    -- l'information n'existe nulle part dans le corpus
      'other'
    ));

COMMENT ON COLUMN copilot_interactions.transcription_raw is
  'Texte brut rendu par le STT avant normalizeTranscript() — diagnostic uniquement, jamais utilisé comme source de fait.';
COMMENT ON COLUMN copilot_interactions.transcription_corrections is
  'Corrections lexicales appliquées par normalizeTranscript(), telles que rendues côté client : [{from, to}].';
COMMENT ON COLUMN copilot_interactions.cause_diagnostic is
  'Classification de la cause racine, posée par un humain (recette) ou une future proposition LLM validée — jamais écrite automatiquement.';
