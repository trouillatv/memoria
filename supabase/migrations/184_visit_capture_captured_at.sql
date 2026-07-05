-- 184 — Moteur d'ingestion : moment RÉEL de la capture + porte d'entrée.
--
-- Jusqu'ici la timeline d'une visite s'ordonne sur `created_at` = le moment
-- d'INSERTION. En direct c'est juste (on insère en shootant). Mais à l'IMPORT
-- (ZIP WhatsApp, upload d'un lot, partage OS, WhatsApp Business), les médias
-- arrivent DANS LE DÉSORDRE : `created_at` ne dit plus rien de la chronologie.
-- On ajoute `captured_at` = l'instant réel (EXIF / horodatage _chat.txt / mtime).
-- La timeline s'ordonne désormais sur coalesce(captured_at, created_at) : le
-- direct (captured_at NULL) garde exactement son comportement, l'import est
-- remis dans l'ordre du terrain.
alter table public.visit_capture
  add column if not exists captured_at timestamptz;

comment on column public.visit_capture.captured_at is
  'Instant RÉEL de la capture (mig 184) — EXIF / horodatage export / mtime. NULL pour le direct (created_at fait foi). Sert à reconstruire la chronologie d''un lot importé et à le découper en sessions de visite.';

-- Trace la PORTE d'entrée de la visite : direct terrain vs import (et sa source).
-- Sert au récap (« Visite importée depuis WhatsApp ») et au futur routage. NULL =
-- visite legacy / direct.
alter table public.site_reports
  add column if not exists source text;

comment on column public.site_reports.source is
  'Porte d''entrée de la visite (mig 184) : NULL/live=direct terrain, whatsapp_zip / upload / os_share / whatsapp_cloud=import. Le pipeline (tri, CR, mémoire) est identique quelle que soit la source.';
