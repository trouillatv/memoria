-- 325_copilot_journal_taxonomy.sql
-- Brique 2 (mandat Vincent 2026-08-17, précision post-audit) : la nomenclature
-- de cause_diagnostic posée en 324 était provisoire. Vincent a fixé la
-- taxonomie minimale exploitable par un futur audit LLM (brique 3) : STT,
-- normalisation, routage, retrieval, relation manquante, entité/donnée
-- absente, donnée contradictoire, génération. On la remplace avant tout usage
-- réel (aucune ligne n'existe encore avec l'ancienne valeur).
--
-- Ajoute aussi : la marque de qualité humaine à 3 états (correcte / incomplète
-- / incorrecte, remplace le pouce haut/bas jamais câblé côté UI), la route STT
-- réellement empruntée, le nombre d'abstentions du normaliseur lexical, et le
-- routage/retrieval retenu (déjà calculé et journalisé en console, jamais
-- persisté) — la matière qui manquait pour qu'un audit distingue
-- "MemorIA n'a pas cherché la bonne relation" de "la donnée n'existe pas".

ALTER TABLE copilot_interactions
  DROP CONSTRAINT IF EXISTS copilot_interactions_cause_diagnostic_check;

ALTER TABLE copilot_interactions
  ADD CONSTRAINT copilot_interactions_cause_diagnostic_check
    CHECK (cause_diagnostic IS NULL OR cause_diagnostic IN (
      'stt_error', 'normalization_error', 'routing_error', 'retrieval_gap',
      'missing_relation', 'missing_entity', 'missing_data', 'conflicting_data',
      'answer_generation_error', 'other'
    ));

ALTER TABLE copilot_interactions
  DROP CONSTRAINT IF EXISTS copilot_interactions_feedback_rating_check;

ALTER TABLE copilot_interactions
  DROP COLUMN IF EXISTS feedback_rating;

ALTER TABLE copilot_interactions
  ADD COLUMN IF NOT EXISTS answer_quality           text,
  ADD COLUMN IF NOT EXISTS stt_route                text,
  ADD COLUMN IF NOT EXISTS transcription_abstentions integer,
  ADD COLUMN IF NOT EXISTS routing_diag             jsonb;

ALTER TABLE copilot_interactions
  ADD CONSTRAINT copilot_interactions_answer_quality_check
    CHECK (answer_quality IS NULL OR answer_quality IN ('correct', 'incomplete', 'incorrect'));

ALTER TABLE copilot_interactions
  ADD CONSTRAINT copilot_interactions_stt_route_check
    CHECK (stt_route IS NULL OR stt_route IN ('client_live', 'server_stt', 'typed'));

COMMENT ON COLUMN copilot_interactions.answer_quality IS
  'Marque humaine à 3 états posée en recette/audit — jamais écrite automatiquement.';
COMMENT ON COLUMN copilot_interactions.stt_route IS
  'client_live = transcript Gemini Live côté téléphone (P3-B) ; server_stt = repli audio→serveur (P2-C) ; typed = question tapée, pas de tour vocal.';
COMMENT ON COLUMN copilot_interactions.transcription_abstentions IS
  'Nombre de termes que le normaliseur lexical (normalizeTranscript) a refusé de corriger faute de confiance suffisante.';
COMMENT ON COLUMN copilot_interactions.routing_diag IS
  'Routage/retrieval retenu pour cette réponse : {det, merged, family, applied, contextChars, finishReason} — déjà calculé en pipeline, seulement journalisé en console avant ce lot.';
COMMENT ON COLUMN copilot_interactions.cause_diagnostic IS
  'Classification de la cause racine (stt_error/normalization_error/routing_error/retrieval_gap/missing_relation/missing_entity/missing_data/conflicting_data/answer_generation_error/other), posée par un humain ou une future proposition LLM validée — jamais écrite automatiquement.';
