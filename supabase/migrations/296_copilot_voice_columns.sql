-- 296_copilot_voice_columns.sql
-- Colonnes de télémétrie vocale pour le Copilote mobile (V1).
--
-- Toutes nullable : les interactions texte restent inchangées.
-- voice_used = false par défaut pour les lignes existantes.

ALTER TABLE copilot_interactions
  ADD COLUMN IF NOT EXISTS voice_used                  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS audio_duration_ms           integer,
  ADD COLUMN IF NOT EXISTS transcription_latency_ms    integer,
  ADD COLUMN IF NOT EXISTS transcription_model         text,
  ADD COLUMN IF NOT EXISTS transcription_tokens_audio  integer,
  ADD COLUMN IF NOT EXISTS transcription_tokens_output integer,
  ADD COLUMN IF NOT EXISTS transcription_error         text;
