-- 095 — Feedback : pièces jointes (captures d'écran / photos)
--
-- Ajout de attachment_paths (chemins Supabase Storage) sur la table feedback.
-- Création du bucket privé "feedback-attachments" avec policies RLS.
-- L'upload est fait server-side (route admin client) — pas de policy INSERT
-- côté storage nécessaire pour l'upload ; la SELECT policy protège la lecture.

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS attachment_paths text[] DEFAULT '{}' NOT NULL;

-- Bucket privé : les URLs sont générées via signed URLs côté admin.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback-attachments',
  'feedback-attachments',
  false,
  5242880,  -- 5 MB par fichier
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Admin peut lire les fichiers (pour les signed URLs).
CREATE POLICY "Admin read feedback attachments"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'feedback-attachments'
    AND public.current_user_role() = 'admin'
  );

COMMENT ON COLUMN public.feedback.attachment_paths IS
  'Chemins Supabase Storage dans le bucket feedback-attachments. Max 3 images, 5 Mo chacune.';
