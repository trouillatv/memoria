-- ============================================================================
-- 237 — Intégrité organisationnelle des équipes
--
-- Cette migration est volontairement défensive et exceptionnelle : elle
-- régularise uniquement l'état de production validé le 24/07/2026.
-- Les UUID ciblés correspondent aux quatre lignes approuvées lors de ce
-- diagnostic (trois backfills et une clôture de membership). Ils ne doivent
-- pas être remplacés par un nettoyage générique : sur un dump, une base de
-- test ou un état de production différent, la migration doit échouer et faire
-- l'objet d'un nouveau diagnostic avant toute régularisation.
-- Si l'état de la base a changé entre le diagnostic et l'application, elle
-- s'arrête avant toute écriture.
-- ============================================================================

begin;

do $$
declare
  v_count integer;
begin
  -- État attendu : exactement les trois lignes connues sans organisation.
  select count(*) into v_count
  from public.team_members
  where organization_id is null;
  if v_count <> 3 then
    raise exception '237 preflight: expected 3 team_members without organization_id, found %', v_count;
  end if;

  if not exists (
    select 1 from public.team_members
    where id = '97fb291f-883d-4de4-a24e-97e2543d709f'
      and organization_id is null
      and team_id = '6b74822f-45d7-46c2-b266-9c1cbc0f6e61'
      and user_id = '31474437-a4e6-4a39-aa3c-d4f4ece9d88e'
      and left_at is not null
  ) or not exists (
    select 1 from public.team_members
    where id = '7ead859c-dd76-4ab7-9bac-e469b26626dd'
      and organization_id is null
      and team_id = '6b74822f-45d7-46c2-b266-9c1cbc0f6e61'
      and user_id = '3dcdf9e6-254f-43ef-afda-205e7e9eb17b'
      and left_at is null
  ) or not exists (
    select 1 from public.team_members
    where id = '021486e9-5bfb-4447-90f2-bbafccb8e3ef'
      and organization_id is null
      and team_id = '31362ad0-9b2e-4256-ab0b-87af02839a68'
      and user_id = 'e5e6e912-0c1a-4eab-b32f-7e0176eb162b'
      and left_at is null
  ) then
    raise exception '237 preflight: the three approved NULL organization rows changed';
  end if;

  -- Seule anomalie active approuvée : Fred Martin, compte supprimé.
  select count(*) into v_count
  from public.team_members tm
  join public.users u on u.id = tm.user_id
  left join public.organization_memberships om
    on om.user_id = tm.user_id
   and om.organization_id = tm.organization_id
   and om.status = 'active'
  where tm.id = '883dd8db-7b7a-4bf5-a02e-878fb539de13'
    and tm.left_at is null
    and u.deleted_at is not null
    and om.id is null;
  if v_count <> 1 then
    raise exception '237 preflight: approved Fred Martin anomaly changed';
  end if;

  -- Aucun autre conflit ne doit être introduit avant la migration.
  select count(*) into v_count
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where tm.organization_id is not null
    and tm.organization_id is distinct from t.organization_id;
  if v_count <> 0 then
    raise exception '237 preflight: found % non-NULL team organization mismatches', v_count;
  end if;

  select count(*) into v_count
  from public.team_members
  where left_at is null
  group by team_id, user_id
  having count(*) > 1;
  if v_count is not null then
    raise exception '237 preflight: active team_member duplicate detected';
  end if;

  select count(*) into v_count
  from public.teams
  where organization_id is null;
  if v_count <> 0 then
    raise exception '237 preflight: found % teams without organization_id', v_count;
  end if;

  select count(*) into v_count
  from public.organization_memberships
  where status not in ('active', 'suspended');
  if v_count <> 0 then
    raise exception '237 preflight: found % memberships with an unexpected status', v_count;
  end if;

  select count(*) into v_count
  from public.organization_memberships
  group by user_id, organization_id
  having count(*) > 1;
  if v_count is not null then
    raise exception '237 preflight: logical organization membership duplicate detected';
  end if;
end $$;

-- Backfill strictement limité aux trois lignes validées.
update public.team_members tm
set organization_id = t.organization_id
from public.teams t
where t.id = tm.team_id
  and tm.id in (
    '97fb291f-883d-4de4-a24e-97e2543d709f',
    '7ead859c-dd76-4ab7-9bac-e469b26626dd',
    '021486e9-5bfb-4447-90f2-bbafccb8e3ef'
  )
  and tm.organization_id is null;

-- Fred Martin : compte supprimé, aucune appartenance organisationnelle active.
update public.team_members
set left_at = coalesce(left_at, now())
where id = '883dd8db-7b7a-4bf5-a02e-878fb539de13'
  and left_at is null;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.team_members where organization_id is null;
  if v_count <> 0 then
    raise exception '237 post-regularization: % NULL organization_id remain', v_count;
  end if;

  select count(*) into v_count
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where tm.organization_id is distinct from t.organization_id;
  if v_count <> 0 then
    raise exception '237 post-regularization: % organization mismatches remain', v_count;
  end if;

  select count(*) into v_count
  from public.team_members tm
  join public.users u on u.id = tm.user_id
  left join public.organization_memberships om
    on om.user_id = tm.user_id
   and om.organization_id = tm.organization_id
   and om.status = 'active'
  where tm.left_at is null and om.id is null;
  if v_count <> 0 then
    raise exception '237 post-regularization: % active team_members lack an active organization membership', v_count;
  end if;
end $$;

create unique index if not exists teams_id_organization_unique
  on public.teams(id, organization_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'teams_id_organization_unique'
      and conrelid = 'public.teams'::regclass
  ) then
    alter table public.teams
      add constraint teams_id_organization_unique
      unique using index teams_id_organization_unique;
  end if;
end $$;

alter table public.team_members
  alter column organization_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_members_team_organization_fk'
      and conrelid = 'public.team_members'::regclass
  ) then
    alter table public.team_members
      add constraint team_members_team_organization_fk
      foreign key (team_id, organization_id)
      references public.teams(id, organization_id)
      on delete cascade;
  end if;
end $$;

create unique index if not exists idx_team_members_active_unique
  on public.team_members(team_id, user_id)
  where left_at is null;

create or replace function public.check_team_member_organization_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_org uuid;
begin
  select organization_id into v_team_org
  from public.teams
  where id = new.team_id;

  if v_team_org is null or v_team_org is distinct from new.organization_id then
    raise exception 'team_member: team and membership organizations must match';
  end if;

  if new.left_at is null and not exists (
    select 1
    from public.organization_memberships om
    where om.user_id = new.user_id
      and om.organization_id = new.organization_id
      and om.status = 'active'
  ) then
    raise exception 'team_member: user has no active organization membership';
  end if;

  return new;
end $$;

drop trigger if exists trg_team_member_organization_integrity on public.team_members;
create trigger trg_team_member_organization_integrity
before insert or update of team_id, user_id, organization_id, left_at
on public.team_members
for each row execute function public.check_team_member_organization_integrity();

create or replace function public.close_team_members_when_org_membership_inactive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.team_members
    set left_at = coalesce(left_at, now())
    where user_id = old.user_id
      and organization_id = old.organization_id
      and left_at is null;
    return old;
  end if;

  if old.status = 'active'
     and (new.status is distinct from 'active'
          or new.user_id is distinct from old.user_id
          or new.organization_id is distinct from old.organization_id) then
    update public.team_members
    set left_at = coalesce(left_at, now())
    where user_id = old.user_id
      and organization_id = old.organization_id
      and left_at is null;
  end if;

  return new;
end $$;

drop trigger if exists trg_close_team_members_on_org_membership_change
  on public.organization_memberships;
create trigger trg_close_team_members_on_org_membership_change
after update of status, user_id, organization_id or delete
on public.organization_memberships
for each row execute function public.close_team_members_when_org_membership_inactive();

comment on column public.team_members.organization_id is
  'Organisation de l’équipe, dérivée de teams. Toute appartenance active exige un organization_membership actif correspondant.';

commit;
