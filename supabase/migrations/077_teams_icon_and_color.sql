-- ===========================================================
-- Migration 077 — Teams · identité visuelle étendue (Vincent 2026-05-21)
--
-- Sprint « Aller plus loin sur le module Équipes » :
--   A1. Color picker libre (hex) en plus des couleurs nommées
--   A2. Pictogramme (icon) pour identité visuelle complémentaire
--
-- Doctrine V2 inchangée — on enrichit l'identité visuelle de l'équipe
-- (CONTENEUR LOGISTIQUE), jamais une dimension analytique.
--
-- IDEMPOTENT : peut être ré-exécutée sans risque (IF NOT EXISTS partout).
-- ===========================================================

alter table public.teams
  add column if not exists icon text;

comment on column public.teams.icon is
  'Vincent 2026-05-21 — Pictogramme lucide-react (kebab-case). Identité visuelle complémentaire à la couleur. Jamais sémantique : pas de chariot=rapide, pas de bouclier=bon agent.';

-- ----------------------------------------------------------------------------
-- Validation hex / nom whitelisté pour color
-- ----------------------------------------------------------------------------
create or replace function public.is_safe_team_color(c text) returns boolean
  language sql immutable as $$
  select c is null
      or c in ('sky','emerald','amber','violet','rose','slate')
      or c ~* '^#[0-9a-f]{6}$'
$$;

comment on function public.is_safe_team_color(text) is
  'Vincent 2026-05-21 — Accepte NULL, 6 noms historiques whitelist, ou hex #rrggbb. Anti-injection visuelle. UI pose des garde-fous fluo distincts.';

alter table public.teams
  drop constraint if exists chk_teams_color_format;
alter table public.teams
  add constraint chk_teams_color_format
  check (public.is_safe_team_color(color));

-- ----------------------------------------------------------------------------
-- Validation format icon
-- ----------------------------------------------------------------------------
create or replace function public.is_safe_team_icon(i text) returns boolean
  language sql immutable as $$
  select i is null
      or (char_length(i) between 1 and 32 and i ~ '^[a-z0-9-]+$')
$$;

comment on function public.is_safe_team_icon(text) is
  'Vincent 2026-05-21 — NULL ou kebab-case (1-32 chars). Whitelist applicative côté UI.';

alter table public.teams
  drop constraint if exists chk_teams_icon_format;
alter table public.teams
  add constraint chk_teams_icon_format
  check (public.is_safe_team_icon(icon));
