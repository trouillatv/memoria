-- Voice notes terrain — doctrine "Mémoire assistée" (2026-05-16)
-- Mis à jour : extraction IA structurée + fragments mémoire intégrés
--
-- Règle fondamentale : l'artefact brut ne disparaît jamais.
-- 6 couches séparées :
--   audio brut / transcription IA / transcription corrigée /
--   extraction IA proposée / extraction humaine validée / fragment mémoire validé
--
-- Seul fragment_validated entre dans les embeddings.

-- ============================================================
-- Bucket privé
-- ============================================================

INSERT INTO storage.buckets (id, name, public) VALUES
  ('intervention-voice-notes', 'intervention-voice-notes', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "intervention-voice-notes read for authenticated" ON storage.objects;
CREATE POLICY "intervention-voice-notes read for authenticated"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'intervention-voice-notes' AND auth.role() = 'authenticated');

-- ============================================================
-- Table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.intervention_voice_notes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id         uuid NOT NULL REFERENCES public.interventions(id) ON DELETE CASCADE,
  site_id                 uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  tenant_id               uuid NOT NULL,  -- single-tenant pilot : pas de table tenants

  -- Couche 1 : artefact brut — jamais supprimé
  storage_path            text NOT NULL,
  mime_type               text NOT NULL DEFAULT 'audio/webm',
  duration_seconds        smallint NOT NULL
    CHECK (duration_seconds BETWEEN 1 AND 30),

  -- Couche 2 : transcription IA (Gemini ou Whisper)
  transcription_raw       text,
  transcription_status    text NOT NULL DEFAULT 'pending'
    CHECK (transcription_status IN ('pending', 'done', 'failed')),

  -- Couche 3 : transcription corrigée par l'humain
  transcription_corrected text,

  -- Couche 4 : extraction IA structurée proposée
  -- {lieux, problemes, equipements, statut, fragment} — jamais écrit en mémoire sans validation
  extraction_proposed     jsonb,

  -- Couche 5 : extraction validée par l'humain
  extraction_validated    jsonb,

  -- Couche 6 : fragment mémoire
  fragment_proposed       text,  -- proposé par l'IA
  fragment_validated      text,  -- validé par l'humain — seul ce texte est embeddé

  -- Validation humaine
  validated_at            timestamptz,
  validated_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- Métadonnées
  recorded_at             timestamptz NOT NULL DEFAULT now(),
  recorded_by             uuid REFERENCES public.users(id) ON DELETE SET NULL,

  status                  text NOT NULL DEFAULT 'pending_transcription'
    CHECK (status IN (
      'pending_transcription',
      'transcribed',
      'extraction_done',
      'validated',
      'ignored'
    ))
);

CREATE INDEX IF NOT EXISTS ivn_intervention_idx ON public.intervention_voice_notes (intervention_id);
CREATE INDEX IF NOT EXISTS ivn_site_status_idx  ON public.intervention_voice_notes (site_id, status);

COMMENT ON TABLE public.intervention_voice_notes IS
  'Doctrine mémoire assistée — 6 couches : audio / transcription IA / corrigée / extraction IA / extraction validée / fragment mémoire. Max 30 sec terrain.';

COMMENT ON COLUMN public.intervention_voice_notes.fragment_validated IS
  'Fragment mémoire validé par l''humain. C''est CE texte — et uniquement lui — qui est embeddé dans la mémoire relationnelle.';

COMMENT ON COLUMN public.intervention_voice_notes.storage_path IS
  'Path relatif dans le bucket intervention-voice-notes. Le binaire audio ne transite jamais par Postgres.';

-- RLS : service role uniquement (server actions via admin client)
ALTER TABLE public.intervention_voice_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.intervention_voice_notes
  FOR ALL USING (auth.role() = 'service_role');
