-- Migration 370 — Planning V1-A : travaux et jalons planifiés documentés.
--
-- Un planning item est une affirmation de planification. Il ne devient ni une
-- échéance, ni une action, ni une visite, ni une réalisation automatiquement.

create table if not exists public.site_planning_items (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  site_id               uuid not null references public.sites(id) on delete cascade,
  kind                  text not null check (kind in ('task', 'milestone')),
  title                 text not null,
  planned_start         date,
  planned_end           date,
  temporal_precision    text not null default 'unknown'
    check (temporal_precision in ('day', 'week', 'range', 'unknown')),
  date_basis            text not null default 'explicit_document'
    check (date_basis in ('explicit_document', 'document_context', 'human_confirmed')),
  status                text not null default 'planned'
    check (status in ('planned', 'superseded', 'cancelled')),
  source_proposal_id    uuid references public.document_extraction_proposal(id) on delete set null,
  canonical_subject_id  uuid references public.canonical_subject(id) on delete set null,
  supersedes_id         uuid references public.site_planning_items(id) on delete set null,
  created_by            uuid references public.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint site_planning_items_dates_order
    check (planned_start is null or planned_end is null or planned_end >= planned_start),
  constraint site_planning_items_temporal_bounds
    check (temporal_precision = 'unknown' or planned_start is not null)
);

create index if not exists site_planning_items_site_idx
  on public.site_planning_items (site_id);
create index if not exists site_planning_items_org_idx
  on public.site_planning_items (organization_id);
create index if not exists site_planning_items_start_idx
  on public.site_planning_items (planned_start);
create index if not exists site_planning_items_status_idx
  on public.site_planning_items (status);
create index if not exists site_planning_items_source_proposal_idx
  on public.site_planning_items (source_proposal_id)
  where source_proposal_id is not null;
create index if not exists site_planning_items_subject_idx
  on public.site_planning_items (canonical_subject_id)
  where canonical_subject_id is not null;
create index if not exists site_planning_items_supersedes_idx
  on public.site_planning_items (supersedes_id)
  where supersedes_id is not null;

comment on table public.site_planning_items is
  'Planning documentaire durable : ce qui est prévu à une date/période. Ne représente pas automatiquement une action, une deadline, une visite ou une réalisation.';
comment on column public.site_planning_items.date_basis is
  'Origine de la date : explicit_document = imprimée dans le document ; document_context = normalisée depuis un contexte documentaire ; human_confirmed = confirmée par un humain.';
comment on column public.site_planning_items.supersedes_id is
  'Version précédente remplacée. L''ancienne ligne reste conservée et passe à superseded.';

-- Service role uniquement, comme les autres objets site-scoped écrits par les
-- repositories server-side ; les repositories filtrent toujours site/org.
alter table public.site_planning_items enable row level security;
drop policy if exists "service_role_full_access" on public.site_planning_items;
create policy "service_role_full_access" on public.site_planning_items
  for all using (auth.role() = 'service_role');

create or replace function public.validate_site_planning_item_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  previous record;
  subject_site uuid;
  proposal_org uuid;
  proposal_site uuid;
begin
  if new.supersedes_id is not null then
    if new.supersedes_id = new.id then
      raise exception 'site_planning_items: auto-référence supersedes_id interdite';
    end if;
    select organization_id, site_id into previous
      from public.site_planning_items where id = new.supersedes_id;
    if not found then
      raise exception 'site_planning_items: version précédente introuvable (%)', new.supersedes_id;
    end if;
    if previous.organization_id <> new.organization_id or previous.site_id <> new.site_id then
      raise exception 'site_planning_items: supersession inter-organisation/chantier interdite';
    end if;

    -- Une chaîne de versions ne doit jamais pouvoir reboucler, y compris lors
    -- d'une correction ultérieure d'une ligne existante.
    if exists (
      with recursive ancestors(id, supersedes_id) as (
        select id, supersedes_id from public.site_planning_items where id = new.supersedes_id
        union all
        select p.id, p.supersedes_id
          from public.site_planning_items p
          join ancestors a on p.id = a.supersedes_id
      )
      select 1 from ancestors where id = new.id
    ) then
      raise exception 'site_planning_items: boucle de supersession interdite';
    end if;
  end if;

  if new.canonical_subject_id is not null then
    select site_id into subject_site from public.canonical_subject where id = new.canonical_subject_id;
    if subject_site is null then
      raise exception 'site_planning_items: sujet canonique introuvable (%)', new.canonical_subject_id;
    end if;
    if subject_site <> new.site_id then
      raise exception 'site_planning_items: sujet canonique d''un autre chantier';
    end if;
  end if;

  if new.source_proposal_id is not null then
    select organization_id, target_site_id into proposal_org, proposal_site
      from public.document_extraction_proposal where id = new.source_proposal_id;
    if proposal_org is null then
      raise exception 'site_planning_items: proposition source introuvable (%)', new.source_proposal_id;
    end if;
    if proposal_org <> new.organization_id
       or (proposal_site is not null and proposal_site <> new.site_id) then
      raise exception 'site_planning_items: provenance source d''un autre périmètre';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists site_planning_items_scope_trigger on public.site_planning_items;
create trigger site_planning_items_scope_trigger
  before insert or update on public.site_planning_items
  for each row execute function public.validate_site_planning_item_scope();
