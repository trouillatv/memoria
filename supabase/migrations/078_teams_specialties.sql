-- ===========================================================
-- Migration 078 — Teams · spécialités déclarées (Vincent 2026-05-21)
--
-- Sprint « Aller plus loin sur le module Équipes » — fiche enrichie B.
--
-- Specialties = tags multi-valeurs déclaratifs (« bio-nettoyage »,
-- « vitrerie », « espaces verts »…). Sert au matcher AO et à l'affectation.
--
-- Doctrine V2 :
--   - Pas de scoring "spécialité = 7/10". C'est un tag déclaratif.
--   - L'équipe DÉCLARE ses spécialités, MemorIA ne les calcule pas.
--   - Aucune dimension comparative.
--
-- IDEMPOTENT.
-- ===========================================================

alter table public.teams
  add column if not exists specialties text[] not null default '{}';

comment on column public.teams.specialties is
  'Vincent 2026-05-21 — Tags déclaratifs de spécialités (kebab-case). Whitelist applicative côté UI. JAMAIS calculées par le système, JAMAIS comparatives.';

-- ----------------------------------------------------------------------------
-- Validation format : chaque tag est kebab-case 1-32 chars, max 12 tags
-- ----------------------------------------------------------------------------
create or replace function public.is_safe_team_specialties(arr text[]) returns boolean
  language sql immutable as $$
  select arr is null
      or (
        array_length(arr, 1) is null
        or (
          array_length(arr, 1) <= 12
          and not exists (
            select 1
            from unnest(arr) as t
            where t is null
               or char_length(t) < 1
               or char_length(t) > 32
               or t !~ '^[a-z0-9-]+$'
          )
        )
      )
$$;

alter table public.teams
  drop constraint if exists chk_teams_specialties_format;
alter table public.teams
  add constraint chk_teams_specialties_format
  check (public.is_safe_team_specialties(specialties));

-- Index GIN pour recherche rapide « équipes ayant la spécialité X »
create index if not exists idx_teams_specialties_gin
  on public.teams using gin (specialties)
  where deleted_at is null;
