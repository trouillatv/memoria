-- Migration 235 — M4a : branding des organisations (logo + couleur).
--
-- Deux colonnes optionnelles sur public.organizations :
--   logo_url  — URL publique du logo (favicon 32 px recommandé). Nullable.
--   color     — Couleur hexadécimale (#RRGGBB) ou Tailwind token. Nullable.
--
-- Ces colonnes ne contiennent que des métadonnées visuelles.
-- Aucune RLS modifiée : la table organizations n'est lue qu'en admin ou via
-- l'admin client (service_role) dans les helpers M3.

alter table public.organizations
  add column if not exists logo_url text,
  add column if not exists color    text;
