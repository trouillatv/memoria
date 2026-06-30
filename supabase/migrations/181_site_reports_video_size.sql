-- 181 — Vidéos de prévisite : upload direct + limite de taille du bucket (Vincent 2026-06-30)
--
-- BUG : l'upload vidéo plantait. Cause = la bodySizeLimit des Server Actions
-- (20 Mo, next.config) rejette toute vidéo de téléphone (souvent 30-150 Mo) AVANT
-- même d'atteindre le code. Fix : la vidéo s'envoie désormais DIRECTEMENT vers
-- Supabase Storage via une URL signée (createSignedUploadUrl), ce qui contourne
-- entièrement Vercel — seule la limite du bucket s'applique.
--
-- On fixe donc explicitement la limite du bucket site-reports à 50 Mo (≈ 30-60 s
-- de vidéo 1080p, suffisant pour le geste vidéo V1). Au-delà = message clair côté
-- client. Pour autoriser plus lourd, il faudra remonter la limite GLOBALE Storage
-- du projet (réglage dashboard, hors migration).

update storage.buckets
  set file_size_limit = 52428800  -- 50 Mo
  where id = 'site-reports';
