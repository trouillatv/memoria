-- Voice note DG sur AO finalisé — doctrine V5 cas validé
--
-- Stockage : Supabase Storage (bucket `tender-voice-notes`, privé).
-- Ce champ ne contient que le path interne au bucket. Le contenu binaire
-- ne transite pas par Postgres.
--
-- Doctrine V5 (2026-05-13) : voice notes sont strictement restreintes.
-- Le cas "AO finalisé" est explicitement autorisé parce que :
--   - Déchargement de frustration (perdu) transformé en mémoire incarnée.
--   - Patrick parle sa déception en 30s plutôt que d'écrire en français-administratif.
--   - C'est la vraie voix du DG qui revient dans le système.
-- Ce n'est PAS une voice note de conversation, c'est une archive personnelle.

ALTER TABLE public.tenders
  ADD COLUMN voice_note_path text,
  ADD COLUMN voice_note_duration_seconds smallint,
  ADD COLUMN voice_note_recorded_at timestamptz,
  ADD COLUMN voice_note_recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_voice_note_duration
    CHECK (
      voice_note_duration_seconds IS NULL
      OR (voice_note_duration_seconds BETWEEN 1 AND 180)
    );

COMMENT ON COLUMN public.tenders.voice_note_path IS
  'Doctrine V5 — voice note DG sur AO finalisé. Cas autorisé de voice note (déchargement + mémoire incarnée). Path interne bucket tender-voice-notes. Max 3 minutes.';
COMMENT ON COLUMN public.tenders.voice_note_duration_seconds IS
  'Durée enregistrée côté client (MediaRecorder). 1..180s. CHECK contraint.';
COMMENT ON COLUMN public.tenders.voice_note_recorded_at IS
  'Timestamp serveur du save (révision = remplacement).';
COMMENT ON COLUMN public.tenders.voice_note_recorded_by IS
  'Auteur. ON DELETE SET NULL pour préserver la mémoire si user supprimé.';

-- ==========================================
-- Storage bucket + policies
-- ==========================================
-- Privé. Service role bypass RLS pour INSERT/DELETE (server actions).
-- SELECT pour authenticated suffit côté lecture car createSignedUrl est appelé
-- via service role de toute façon (admin client).

insert into storage.buckets (id, name, public) values
  ('tender-voice-notes', 'tender-voice-notes', false)
on conflict (id) do nothing;

drop policy if exists "tender-voice-notes read for authenticated" on storage.objects;
create policy "tender-voice-notes read for authenticated"
  on storage.objects for select
  using (bucket_id = 'tender-voice-notes' and auth.role() = 'authenticated');
