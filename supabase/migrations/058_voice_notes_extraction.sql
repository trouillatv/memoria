-- Extraction IA structurée + fragments mémoire (2026-05-16)
-- Migration idempotente : sans effet si migration 056 a déjà créé ces colonnes.
--
-- Règle : seul fragment_validated entre dans les embeddings.

-- Colonnes d'extraction (IF NOT EXISTS = no-op si déjà présentes via 056 corrigée)
ALTER TABLE public.intervention_voice_notes
  ADD COLUMN IF NOT EXISTS extraction_proposed  jsonb,
  ADD COLUMN IF NOT EXISTS extraction_validated jsonb,
  ADD COLUMN IF NOT EXISTS fragment_proposed    text,
  ADD COLUMN IF NOT EXISTS fragment_validated   text;

-- Mettre à jour le CHECK sur status pour inclure extraction_done.
-- On cherche et supprime la contrainte existante par son contenu (nom auto-généré en inline).
DO $$
DECLARE
  c_name text;
BEGIN
  SELECT tc.constraint_name INTO c_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc USING (constraint_name, constraint_schema)
  WHERE tc.table_schema = 'public'
    AND tc.table_name   = 'intervention_voice_notes'
    AND tc.constraint_type = 'CHECK'
    AND cc.check_clause LIKE '%status%'
  LIMIT 1;

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.intervention_voice_notes DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

ALTER TABLE public.intervention_voice_notes
  ADD CONSTRAINT ivn_status_check
  CHECK (status IN (
    'pending_transcription',
    'transcribed',
    'extraction_done',
    'validated',
    'ignored'
  ));

COMMENT ON COLUMN public.intervention_voice_notes.extraction_proposed IS
  'Extraction IA structurée {lieux, problemes, equipements, statut, fragment}. Jamais écrit en mémoire sans validation humaine.';
COMMENT ON COLUMN public.intervention_voice_notes.extraction_validated IS
  'Sous-ensemble sélectionné et validé par l''humain depuis extraction_proposed.';
COMMENT ON COLUMN public.intervention_voice_notes.fragment_proposed IS
  'Fragment mémoire court proposé par l''IA (max ~10 mots).';
COMMENT ON COLUMN public.intervention_voice_notes.fragment_validated IS
  'Fragment mémoire validé par l''humain. C''est CE texte — et uniquement lui — qui est embeddé dans la mémoire relationnelle.';
