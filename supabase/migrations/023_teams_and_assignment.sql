-- ===========================================================
-- Migration 023 : Teams + assigned_team_id
--
-- Spec : docs/superpowers/plans/2026-05-12-phase-9-vue-semaine.md (Slice 9.0)
-- Branch : feat/phase-9-vue-semaine
-- Doctrine : docs/superpowers/doctrines/planning-doctrine.md (V2)
--
-- Doctrine V2 — Organisation vs Surveillance :
--   « On organise la couverture par équipe, jamais par individu. »
--
-- Une équipe est un CONTENEUR LOGISTIQUE de couverture. Jamais une unité
-- analytique. Pas de score, pas de KPI, pas de charge, pas de saturation.
-- Composition variable dans le temps via team_members.joined_at/left_at.
--
-- INTERDITS ABSOLUS (signaux ROUGE doctrine V2) :
--   - assigned_to_user_id sur missions ou interventions (jamais)
--   - colonnes score / capacity / max_load / charge_max / performance sur teams
--   - métriques d'équipe (productivité, complétion, saturation)
-- ===========================================================

-- ==========================================
-- Table : teams
-- ==========================================
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null,
  deleted_at  timestamptz,
  constraint chk_team_name_length check (
    char_length(trim(name)) >= 1 and char_length(name) <= 50
  )
);

comment on table public.teams is
  'Doctrine V2 : conteneur logistique de couverture. JAMAIS unité analytique. Pas de score, pas de KPI, pas de charge.';

comment on column public.teams.color is
  'Couleur sobre pour lisibilité visuelle uniquement. Jamais sémantique (pas de rouge=mauvais, vert=bon).';

comment on column public.teams.deleted_at is
  'Soft-delete : archive l''équipe sans purger l''historique. Désaffecte missions/interventions via ON DELETE SET NULL côté FK.';

-- Unicité du nom parmi les équipes actives (case-insensitive)
create unique index idx_teams_name_active
  on public.teams(lower(name))
  where deleted_at is null;

-- ==========================================
-- Table : team_members (composition variable dans le temps)
-- ==========================================
create table public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz
);

comment on table public.team_members is
  'Composition d''équipe — variable dans le temps. left_at IS NULL = membre actif. Sinon, membre passé (historique conservé).';

comment on column public.team_members.left_at is
  'Si NULL, l''utilisateur est membre actif. Sinon, date de sortie de l''équipe. Permet de retracer la composition historique.';

create index idx_team_members_team_active
  on public.team_members(team_id)
  where left_at is null;

create index idx_team_members_user_active
  on public.team_members(user_id)
  where left_at is null;

-- Un user ne peut pas être 2x dans la même équipe simultanément
create unique index idx_team_members_active_unique
  on public.team_members(team_id, user_id)
  where left_at is null;

-- ==========================================
-- Affectation par équipe (jamais par user)
-- ==========================================
alter table public.missions
  add column assigned_team_id uuid references public.teams(id) on delete set null;

alter table public.interventions
  add column assigned_team_id uuid references public.teams(id) on delete set null;

comment on column public.missions.assigned_team_id is
  'Affectation par équipe (doctrine V2). NE JAMAIS introduire assigned_to_user_id. ON DELETE SET NULL : supprimer une équipe désaffecte, ne supprime pas la mission.';

comment on column public.interventions.assigned_team_id is
  'Affectation par équipe (doctrine V2). NE JAMAIS introduire assigned_to_user_id. ON DELETE SET NULL : supprimer une équipe désaffecte, ne supprime pas l''intervention.';

create index idx_missions_assigned_team
  on public.missions(assigned_team_id)
  where assigned_team_id is not null;

create index idx_interventions_assigned_team
  on public.interventions(assigned_team_id)
  where assigned_team_id is not null;

-- Index utile pour la vue semaine (lookup par jour + équipe)
create index if not exists idx_interventions_scheduled_for_team
  on public.interventions(scheduled_for, assigned_team_id)
  where scheduled_for is not null;

-- ==========================================
-- RLS — admin/manager full access, chef_equipe read teams + own membership
-- ==========================================
alter table public.teams enable row level security;
alter table public.team_members enable row level security;

drop policy if exists "admin manager full access teams" on public.teams;
create policy "admin manager full access teams"
  on public.teams
  for all
  using      (public.current_user_role() in ('admin','manager'))
  with check (public.current_user_role() in ('admin','manager'));

drop policy if exists "chef_equipe read teams" on public.teams;
create policy "chef_equipe read teams"
  on public.teams
  for select
  using (public.current_user_role() = 'chef_equipe');

drop policy if exists "admin manager full access team_members" on public.team_members;
create policy "admin manager full access team_members"
  on public.team_members
  for all
  using      (public.current_user_role() in ('admin','manager'))
  with check (public.current_user_role() in ('admin','manager'));

drop policy if exists "chef_equipe read own team_membership" on public.team_members;
create policy "chef_equipe read own team_membership"
  on public.team_members
  for select
  using (public.current_user_role() = 'chef_equipe' and user_id = auth.uid());
