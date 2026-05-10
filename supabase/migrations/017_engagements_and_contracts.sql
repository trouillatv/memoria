-- Migration 017 : engagements + contracts (Phase 1 — boucle stratégique AO ↔ Field)
--
-- Spec : docs/superpowers/specs/2026-05-10-engagement-loop-design.md
-- Cockpit : docs/superpowers/specs/2026-05-10-engagement-cockpit-design.md
--
-- Note : codebase single-tenant role-based (pas de multi-tenant org_id).
-- Pattern aligné sur les migrations existantes (lowercase, public.<table>,
-- ENUMs, soft-delete, RLS via current_user_role()).

-- ==========================================
-- Enums
-- ==========================================
create type contract_status        as enum ('active', 'paused', 'terminated', 'archived');
create type engagement_source_type as enum ('ao_clause', 'memoire_engagement', 'manual');
create type engagement_category    as enum ('frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other');
create type engagement_status      as enum ('extracted', 'curated', 'active', 'completed', 'archived');
-- Note : pas de 'breached' dans engagement_status. La santé opérationnelle est
-- calculée view-side via les ratios PROMIS/PLANIFIÉ/EXÉCUTÉ/PROUVÉ/VALIDÉ
-- (cf. cockpit-design.md §1).

-- ==========================================
-- contracts — un AO gagné devient un contrat opérationnel
-- ==========================================
create table public.contracts (
  id           uuid primary key default gen_random_uuid(),
  tender_id    uuid references public.tenders(id) on delete set null,
  name         text not null check (length(name) between 1 and 200),
  client_name  text not null check (length(client_name) between 1 and 200),
  start_date   date not null,
  end_date     date,
  status       contract_status not null default 'active',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  deleted_at   timestamptz,
  created_by   uuid references public.users(id) on delete set null
);

create index contracts_tender_idx on public.contracts(tender_id) where deleted_at is null;
create index contracts_active_idx on public.contracts(status) where deleted_at is null and status = 'active';

-- ==========================================
-- engagements — entité-pivot AO ↔ Field
-- ==========================================
create table public.engagements (
  id              uuid primary key default gen_random_uuid(),
  tender_id       uuid not null references public.tenders(id) on delete cascade,
  contract_id     uuid references public.contracts(id) on delete set null,
  source_type     engagement_source_type not null,
  source_excerpt  text not null check (length(source_excerpt) between 5 and 2000),
  source_ref      jsonb,
  category        engagement_category not null,
  short_label     text not null check (length(short_label) between 3 and 100),
  measurable      boolean not null default false,
  ai_confidence   numeric(3,2) check (ai_confidence between 0 and 1),
  status          engagement_status not null default 'extracted',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  created_by      uuid references public.users(id) on delete set null
);

create index engagements_tender_idx   on public.engagements(tender_id);
create index engagements_contract_idx on public.engagements(contract_id) where contract_id is not null;
create index engagements_status_idx   on public.engagements(status);

-- ==========================================
-- updated_at triggers
-- ==========================================
create or replace function public.update_contracts_updated_at()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_contracts_updated_at on public.contracts;
create trigger trg_contracts_updated_at
  before update on public.contracts
  for each row
  execute function public.update_contracts_updated_at();

create or replace function public.update_engagements_updated_at()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_engagements_updated_at on public.engagements;
create trigger trg_engagements_updated_at
  before update on public.engagements
  for each row
  execute function public.update_engagements_updated_at();

-- ==========================================
-- RLS — pattern role-based aligné sur clients / sites / tenders
-- ==========================================
alter table public.contracts enable row level security;

drop policy if exists "contracts authenticated read" on public.contracts;
create policy "contracts authenticated read" on public.contracts
  for select using (auth.role() = 'authenticated');

drop policy if exists "contracts manager admin write" on public.contracts;
create policy "contracts manager admin write" on public.contracts
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

alter table public.engagements enable row level security;

drop policy if exists "engagements authenticated read" on public.engagements;
create policy "engagements authenticated read" on public.engagements
  for select using (auth.role() = 'authenticated');

drop policy if exists "engagements manager admin write" on public.engagements;
create policy "engagements manager admin write" on public.engagements
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));
