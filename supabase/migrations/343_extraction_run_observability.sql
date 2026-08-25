-- Migration 343 — Observabilité extraction : longueur texte + raison vide
--
-- Deux colonnes ajoutées à document_extraction_run :
--   extracted_text_length  — nombre de caractères extraits avant LLM (toujours rempli si extraction réussie)
--   empty_reason           — raison si 0 proposal ; NULL si proposals > 0
--
-- Valeurs possibles de empty_reason :
--   SUCCESS_WITH_CONTENT        — proposals > 0 (jamais stocké ici, reserved pour signaler)
--   NO_BUSINESS_ELEMENT_DETECTED — analyse réussie, aucun élément métier détecté
--   OCR_FAILURE                 — extraction texte échouée (document scanné non OCRisable)
--   LLM_TIMEOUT                 — timeout ou erreur réseau lors de l'appel Gemini
--   TECHNICAL_FAILURE           — toute autre erreur technique

ALTER TABLE public.document_extraction_run
  ADD COLUMN IF NOT EXISTS extracted_text_length int NULL,
  ADD COLUMN IF NOT EXISTS empty_reason text NULL
    CHECK (empty_reason IN (
      'NO_BUSINESS_ELEMENT_DETECTED',
      'OCR_FAILURE',
      'LLM_TIMEOUT',
      'TECHNICAL_FAILURE'
    ));

COMMENT ON COLUMN public.document_extraction_run.extracted_text_length IS
  'Nombre de caractères du texte extrait avant envoi au LLM. NULL si extraction non atteinte.';

COMMENT ON COLUMN public.document_extraction_run.empty_reason IS
  'Raison sémantique du résultat vide. NULL si proposals > 0 ou si extraction encore en cours.';
