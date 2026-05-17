-- Migration 067 : colonne ai_caption sur intervention_photos
-- Stocke la description Gemini Vision (analyse photo anomalie).
-- Nullable : null = pas encore analysée ou analyse désactivée.
ALTER TABLE public.intervention_photos
  ADD COLUMN IF NOT EXISTS ai_caption text;
