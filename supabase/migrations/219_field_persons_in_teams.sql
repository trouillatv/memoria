-- ===========================================================
-- Migration 219 : la personne TERRAIN entre dans l'équipe — sans compte.
--
-- Lot 1 (Vincent, 2026-07-18). Le parcours « planifier une intervention »
-- se brisait sur un maillon : l'équipe créée inline naissait vide, et ajouter
-- quelqu'un exigeait de créer un COMPTE (users.id → auth.users). Or « M. X,
-- électricien, vu sur la visite » n'a pas vocation à se connecter.
--
-- Décisions de forme (validées) :
--   · AUCUNE nouvelle notion de personne. company_contacts devient le socle
--     canonique des personnes terrain : entreprise désormais OPTIONNELLE,
--     isolation portée directement par organization_id.
--   · team_members reste réservé aux utilisateurs CONNECTÉS : ses 33 lecteurs
--     (briefings, passation, continuité…) supposent un compte, à raison.
--     L'appartenance des personnes terrain vit dans une arête distincte :
--     team_field_members. Deux appartenances, UNE notion de personne.
--   · La cohérence tenant est garantie par TRIGGER — il s'exécute aussi sous
--     service-role (qui bypasse la RLS) : l'impossibilité de relier deux
--     tenants est réelle, pas seulement déclarative.
--
-- Ce que cette migration NE fait PAS (périmètre gelé) : affectation
-- individuelle d'une intervention, alias, fusion, liaison à un utilisateur.
-- Rien ici ne les empêche plus tard : ids stables, colonnes additives.
-- ===========================================================

-- 1) L'entreprise devient optionnelle : une personne peut être connue avant
--    son entreprise (« M. X », « Électricien »). On n'invente pas une société
--    « Inconnue » pour satisfaire la base.
alter table public.company_contacts
  alter column company_id drop not null;

-- 2) L'isolation ne dépend plus d'une relation optionnelle : l'organisation
--    est portée par le contact lui-même.
alter table public.company_contacts
  add column if not exists organization_id uuid references public.organizations(id);

update public.company_contacts cc
set organization_id = c.organization_id
from public.companies c
where cc.company_id = c.id
  and cc.organization_id is null;

alter table public.company_contacts
  alter column organization_id set not null;

create index if not exists idx_company_contacts_org
  on public.company_contacts(organization_id)
  where deleted_at is null;

-- RLS : lecture directe par organisation (plus de détour par companies —
-- le détour ne couvrirait pas les contacts sans entreprise).
drop policy if exists "company_contacts read" on public.company_contacts;
create policy "company_contacts read" on public.company_contacts
  for select using (organization_id = public.current_user_org_id());

-- Cohérence contact ↔ entreprise : si une entreprise est choisie, elle
-- appartient au même tenant. Trigger = garanti aussi sous service-role.
create or replace function public.check_company_contact_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_org uuid;
begin
  if new.organization_id is null then
    raise exception 'company_contacts: organization_id requis';
  end if;
  if new.company_id is not null then
    select organization_id into v_company_org from public.companies where id = new.company_id;
    if v_company_org is distinct from new.organization_id then
      raise exception 'company_contacts: l''entreprise n''appartient pas à la même organisation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_company_contacts_org on public.company_contacts;
create trigger trg_company_contacts_org
  before insert or update on public.company_contacts
  for each row execute function public.check_company_contact_org();

-- 3) L'appartenance des personnes terrain aux équipes.
create table if not exists public.team_field_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  team_id         uuid not null references public.teams(id) on delete cascade,
  contact_id      uuid not null references public.company_contacts(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null
);

comment on table public.team_field_members is
  'Appartenance des personnes TERRAIN (company_contacts, sans compte) aux équipes. '
  'team_members reste réservé aux utilisateurs connectés. Doctrine V2 inchangée : '
  'l''intervention s''affecte à l''ÉQUIPE, jamais à un individu.';

-- Pas de doublon ACTIF, mais l'historique reste possible : un contact peut
-- quitter une équipe (left_at) puis y revenir (nouvelle ligne).
create unique index if not exists uq_team_field_members_active
  on public.team_field_members(team_id, contact_id)
  where left_at is null;

create index if not exists idx_team_field_members_team
  on public.team_field_members(team_id)
  where left_at is null;

create index if not exists idx_team_field_members_org
  on public.team_field_members(organization_id);

-- Triple cohérence (ligne = équipe = contact, même tenant) + refus des
-- contacts archivés à l'entrée. organization_id est dupliqué pour une RLS
-- directe et lisible — le trigger garantit qu'il ne peut pas mentir.
create or replace function public.check_team_field_member_coherence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_org uuid;
  v_contact_org uuid;
  v_contact_deleted timestamptz;
begin
  select organization_id into v_team_org from public.teams where id = new.team_id;
  select organization_id, deleted_at into v_contact_org, v_contact_deleted
    from public.company_contacts where id = new.contact_id;

  if new.organization_id is null
     or v_team_org is distinct from new.organization_id
     or v_contact_org is distinct from new.organization_id then
    raise exception 'team_field_members: équipe, contact et ligne doivent appartenir au même tenant';
  end if;

  -- Un contact archivé ne se rattache pas ; en revanche l'archiver plus tard
  -- ne détruit pas son historique (les lignes restent, on UPDATE left_at).
  if tg_op = 'INSERT' and v_contact_deleted is not null then
    raise exception 'team_field_members: contact archivé — rattachement refusé';
  end if;

  return new;
end $$;

drop trigger if exists trg_team_field_members_coherence on public.team_field_members;
create trigger trg_team_field_members_coherence
  before insert or update on public.team_field_members
  for each row execute function public.check_team_field_member_coherence();

alter table public.team_field_members enable row level security;
drop policy if exists "team_field_members read" on public.team_field_members;
create policy "team_field_members read" on public.team_field_members
  for select using (organization_id = public.current_user_org_id());
