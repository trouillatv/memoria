-- Migration 084 — users.theme_preference (Vincent 2026-05-26)
--
-- Persistance du thème UI préféré PAR utilisateur (light | dark | ocre | petrole).
-- Sauvegardé à chaque changement via le sélecteur, réappliqué au login
-- (cross-device, pas seulement localStorage). NULL = pas défini → fallback
-- 'light' côté client.

alter table public.users
  add column if not exists theme_preference text;

comment on column public.users.theme_preference is
  'Thème UI préféré (light | dark | ocre | petrole). NULL = non défini, fallback light. Vincent 2026-05-26.';
