-- Migration 235 — M4a : branding des organisations (logo + couleur).
--
-- Deux colonnes optionnelles sur public.organizations :
--   logo_url  — URL publique du logo (favicon 32 px recommandé). Nullable.
--   color     — Couleur hexadécimale #RRGGBB uniquement. Nullable.
--
-- Ces colonnes ne contiennent que des métadonnées visuelles.
-- Aucune RLS modifiée : la table organizations n'est lue qu'en admin ou via
-- l'admin client (service_role) dans les helpers M3.

alter table public.organizations
  add column if not exists logo_url text,
  add column if not exists color    text;

alter table public.organizations
  drop constraint if exists organizations_color_hex_format,
  add  constraint organizations_color_hex_format
    check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
