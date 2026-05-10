-- Migration 018 : Field MVP — drop legacy + sites linked to contracts
--                  + missions (recipe) + interventions (instance)
--                  + checklist + photos + anomalies + validations.
--
-- Spec : docs/superpowers/specs/2026-05-10-engagement-loop-design.md (Phase 2)
-- Branch : feat/field-mvp
--
-- Décision : les tables legacy (missions/mission_checklist_items/mission_photos/incidents)
-- de la migration 004 sont DROPées car inutilisées (placeholder UI uniquement) et leur
-- sémantique conflicte avec la nouvelle architecture (existing missions = instance, nouvelle
-- mission = recette).

-- ==========================================
-- DROP legacy unused tables (zero data loss confirmed)
-- ==========================================
drop table if exists public.incidents cascade;
drop table if exists public.mission_photos cascade;
drop table if exists public.mission_checklist_items cascade;
drop table if exists public.missions cascade;
drop type if exists mission_status;

-- ==========================================
-- ALTER sites — link to contracts
-- ==========================================
alter table public.sites
  add column if not exists contract_id uuid references public.contracts(id) on delete set null;

create index if not exists sites_contract_idx on public.sites(contract_id) where deleted_at is null;

-- ==========================================
-- New ENUMs
-- ==========================================
create type mission_cadence     as enum ('daily', 'weekly', 'biweekly', 'monthly', 'on_demand');
create type intervention_status as enum ('planned', 'in_progress', 'completed', 'validated', 'skipped');
create type photo_kind          as enum ('before', 'after', 'anomaly', 'proof');
create type anomaly_category    as enum ('eau_coupee', 'materiel_casse', 'acces_bloque', 'produit_manquant', 'autre');
create type anomaly_status      as enum ('open', 'resolved', 'ignored');

-- ==========================================
-- missions — la RECETTE (ce qu'il faut faire à ce site, à quelle cadence)
-- ==========================================
create table public.missions (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid not null references public.sites(id) on delete cascade,
  name              text not null check (length(name) between 1 and 200),
  description       text,
  cadence           mission_cadence not null default 'on_demand',
  default_team      uuid[] not null default '{}',                -- user IDs assignés par défaut
  engagement_ids    uuid[] not null default '{}',                -- engagements couverts
  default_checklist jsonb  not null default '[]'::jsonb,         -- [{label, required, engagement_id?, position}]
  active            boolean not null default true,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  deleted_at        timestamptz,
  created_by        uuid references public.users(id) on delete set null
);

create index missions_site_idx on public.missions(site_id) where deleted_at is null;
create index missions_active_idx on public.missions(site_id, active) where deleted_at is null and active = true;

-- ==========================================
-- interventions — l'INSTANCE (une exécution datée)
-- ==========================================
create table public.interventions (
  id            uuid primary key default gen_random_uuid(),
  mission_id    uuid not null references public.missions(id) on delete cascade,
  scheduled_at  timestamptz not null,
  executed_at   timestamptz,
  team          uuid[] not null default '{}',                  -- équipe réelle ce jour-là
  status        intervention_status not null default 'planned',
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  created_by    uuid references public.users(id) on delete set null
);

create index interventions_mission_idx     on public.interventions(mission_id);
create index interventions_status_idx      on public.interventions(status);
create index interventions_scheduled_idx   on public.interventions(scheduled_at desc);

-- ==========================================
-- intervention_checklist_items — checklist exécutée par intervention
-- ==========================================
create table public.intervention_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  engagement_id   uuid references public.engagements(id) on delete set null, -- héritage automatique du template
  label           text not null,
  position        int  not null default 0,
  required        boolean not null default false,
  done            boolean not null default false,
  done_at         timestamptz,
  done_by         uuid references public.users(id) on delete set null
);

create index intervention_checklist_items_intervention_idx on public.intervention_checklist_items(intervention_id);
create index intervention_checklist_items_engagement_idx   on public.intervention_checklist_items(engagement_id) where engagement_id is not null;

-- ==========================================
-- intervention_photos — preuves photos
-- ==========================================
create table public.intervention_photos (
  id                uuid primary key default gen_random_uuid(),
  intervention_id   uuid not null references public.interventions(id) on delete cascade,
  checklist_item_id uuid references public.intervention_checklist_items(id) on delete set null,
  storage_path      text not null,
  kind              photo_kind not null,
  caption           text,
  taken_at          timestamptz not null default now(),  -- TIMESTAMP SERVEUR opposable
  taken_by          uuid references public.users(id) on delete set null
);

create index intervention_photos_intervention_idx on public.intervention_photos(intervention_id);
create index intervention_photos_checklist_idx    on public.intervention_photos(checklist_item_id) where checklist_item_id is not null;
create index intervention_photos_kind_idx         on public.intervention_photos(kind);

-- ==========================================
-- intervention_anomalies — événements terrain
-- ==========================================
create table public.intervention_anomalies (
  id              uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  engagement_id   uuid references public.engagements(id) on delete set null,
  category        anomaly_category not null,
  category_other  text,                                          -- texte libre si category='autre'
  description     text,
  status          anomaly_status not null default 'open',
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz default now(),
  reported_by     uuid references public.users(id) on delete set null
);

create index intervention_anomalies_intervention_idx on public.intervention_anomalies(intervention_id);
create index intervention_anomalies_engagement_idx   on public.intervention_anomalies(engagement_id) where engagement_id is not null;
create index intervention_anomalies_status_idx       on public.intervention_anomalies(status);

-- ==========================================
-- intervention_validations — signature superviseur (1 par intervention max)
-- ==========================================
create table public.intervention_validations (
  id              uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  validated_by    uuid not null references public.users(id) on delete restrict,
  validated_at    timestamptz not null default now(),
  comment         text                                           -- optionnel
);

create unique index intervention_validations_unique on public.intervention_validations(intervention_id);
create index intervention_validations_validator_idx on public.intervention_validations(validated_by);

-- ==========================================
-- updated_at triggers
-- ==========================================
create or replace function public.update_missions_updated_at() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_missions_updated_at on public.missions;
create trigger trg_missions_updated_at before update on public.missions
  for each row execute function public.update_missions_updated_at();

create or replace function public.update_interventions_updated_at() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_interventions_updated_at on public.interventions;
create trigger trg_interventions_updated_at before update on public.interventions
  for each row execute function public.update_interventions_updated_at();

-- ==========================================
-- RLS — pattern role-based (admin/manager full access, authenticated read)
-- ==========================================
alter table public.missions enable row level security;
drop policy if exists "missions auth read" on public.missions;
create policy "missions auth read" on public.missions
  for select using (auth.role() = 'authenticated');
drop policy if exists "missions manager write" on public.missions;
create policy "missions manager write" on public.missions
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

alter table public.interventions enable row level security;
drop policy if exists "interventions auth read" on public.interventions;
create policy "interventions auth read" on public.interventions
  for select using (auth.role() = 'authenticated');
drop policy if exists "interventions manager write" on public.interventions;
create policy "interventions manager write" on public.interventions
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

alter table public.intervention_checklist_items enable row level security;
drop policy if exists "intervention_checklist_items auth read" on public.intervention_checklist_items;
create policy "intervention_checklist_items auth read" on public.intervention_checklist_items
  for select using (auth.role() = 'authenticated');
drop policy if exists "intervention_checklist_items manager write" on public.intervention_checklist_items;
create policy "intervention_checklist_items manager write" on public.intervention_checklist_items
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

alter table public.intervention_photos enable row level security;
drop policy if exists "intervention_photos auth read" on public.intervention_photos;
create policy "intervention_photos auth read" on public.intervention_photos
  for select using (auth.role() = 'authenticated');
drop policy if exists "intervention_photos manager write" on public.intervention_photos;
create policy "intervention_photos manager write" on public.intervention_photos
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

alter table public.intervention_anomalies enable row level security;
drop policy if exists "intervention_anomalies auth read" on public.intervention_anomalies;
create policy "intervention_anomalies auth read" on public.intervention_anomalies
  for select using (auth.role() = 'authenticated');
drop policy if exists "intervention_anomalies manager write" on public.intervention_anomalies;
create policy "intervention_anomalies manager write" on public.intervention_anomalies
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

alter table public.intervention_validations enable row level security;
drop policy if exists "intervention_validations auth read" on public.intervention_validations;
create policy "intervention_validations auth read" on public.intervention_validations
  for select using (auth.role() = 'authenticated');
drop policy if exists "intervention_validations manager write" on public.intervention_validations;
create policy "intervention_validations manager write" on public.intervention_validations
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- ==========================================
-- Storage bucket — intervention-photos (preuves photo opposables)
-- Pattern aligné sur 010_buckets.sql : private bucket + signed URLs côté app.
-- ==========================================
insert into storage.buckets (id, name, public) values
  ('intervention-photos', 'intervention-photos', false)
on conflict (id) do nothing;

drop policy if exists "intervention-photos read for authenticated" on storage.objects;
create policy "intervention-photos read for authenticated"
  on storage.objects for select
  using (bucket_id = 'intervention-photos' and auth.role() = 'authenticated');
