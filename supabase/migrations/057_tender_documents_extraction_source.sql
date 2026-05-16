-- OCR AO — colonne extraction_source (2026-05-16)
-- Trace l'origine du texte extrait : 'native' (pdf-parse) ou 'ocr' (Gemini Vision).
-- Default 'native' rétrocompatible : les lignes existantes restent valides.

ALTER TABLE public.tender_documents
  ADD COLUMN IF NOT EXISTS extraction_source text NOT NULL DEFAULT 'native'
  CHECK (extraction_source IN ('native', 'ocr'));

COMMENT ON COLUMN public.tender_documents.extraction_source IS
  'native = texte extrait par pdf-parse. ocr = texte reconnu par Gemini Vision sur PDF scanné.';
