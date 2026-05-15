-- Voice notes terrain — doctrine "Mémoire assistée" (2026-05-16)
--
-- Règle fondamentale : l'artefact brut ne disparaît jamais.
-- 3 couches séparées : audio brut / transcription IA / validation humaine.
-- Le fragment mémoire enregistré = ce que l'humain a validé, jamais la détection IA seule.

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
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Couche 1 : artefact brut — jamais supprimé
  storage_path            text NOT NULL,
  mime_type               text NOT NULL DEFAULT 'audio/webm',
  duration_seconds        smallint NOT NULL
    CHECK (duration_seconds BETWEEN 1 AND 30),

  -- Couche 2 : extraction IA (Whisper)
  transcription_raw       text,
  transcription_status    text NOT NULL DEFAULT 'pending'
    CHECK (transcription_status IN ('pending', 'done', 'failed')),

  -- Couche 3 : validation humaine
  transcription_corrected text,
  validated_at            timestamptz,
  validated_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- Métadonnées
  recorded_at             timestamptz NOT NULL DEFAULT now(),
  recorded_by             uuid REFERENCES public.users(id) ON DELETE SET NULL,

  status                  text NOT NULL DEFAULT 'pending_transcription'
    CHECK (status IN ('pending_transcription', 'transcribed', 'validated', 'ignored'))
);

CREATE INDEX IF NOT EXISTS ivn_intervention_idx ON public.intervention_voice_notes (intervention_id);
CREATE INDEX IF NOT EXISTS ivn_site_status_idx  ON public.intervention_voice_notes (site_id, status);

COMMENT ON TABLE public.intervention_voice_notes IS
  'Doctrine mémoire assistée — 3 couches : audio brut / transcription Whisper / texte validé humain. Max 30 sec terrain.';

COMMENT ON COLUMN public.intervention_voice_notes.transcription_corrected IS
  'Texte corrigé par l''utilisateur. C''est cette version qui alimente les embeddings — jamais la sortie Whisper brute seule.';

COMMENT ON COLUMN public.intervention_voice_notes.storage_path IS
  'Path relatif dans le bucket intervention-voice-notes. Le binaire audio ne transite jamais par Postgres.';

-- RLS : service role uniquement (server actions via admin client)
ALTER TABLE public.intervention_voice_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.intervention_voice_notes
  FOR ALL USING (auth.role() = 'service_role');
