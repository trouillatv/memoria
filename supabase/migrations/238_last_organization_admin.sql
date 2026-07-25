-- ============================================================================
-- 238 — Gouvernance : protection transactionnelle du dernier admin d'organisation
-- ============================================================================
-- Toute mutation qui ferait passer le nombre d'admins organisationnels actifs
-- de 1 à 0 est refusée. Le verrou sur la ligne organizations sérialise les
-- mutations concurrentes visant la même organisation.

begin;

create or replace function public.protect_last_active_organization_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining_admins integer;
begin
  if old.status = 'active'
     and old.role = 'admin'
     and (
       tg_op = 'DELETE'
       or new.status is distinct from 'active'
       or new.role is distinct from 'admin'
       or new.organization_id is distinct from old.organization_id
     ) then
    -- Verrou transactionnel : deux retraits concurrents ne peuvent pas
    -- constater simultanément qu'il reste un autre administrateur.
    perform 1
    from public.organizations
    where id = old.organization_id
    for update;

    select count(*) into v_remaining_admins
    from public.organization_memberships om
    where om.organization_id = old.organization_id
      and om.role = 'admin'
      and om.status = 'active'
      and om.id <> old.id;

    if v_remaining_admins = 0 then
      raise exception using
        errcode = 'P0001',
        message = 'organization_membership_last_admin',
        detail = 'The last active organization administrator cannot be removed, suspended, or downgraded';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_last_active_organization_admin
  on public.organization_memberships;
create trigger trg_protect_last_active_organization_admin
before update of role, status, organization_id, user_id or delete
on public.organization_memberships
for each row execute function public.protect_last_active_organization_admin();

comment on function public.protect_last_active_organization_admin() is
  'Refuse toute mutation qui supprimerait le dernier organization_membership admin actif, avec verrou transactionnel par organisation.';

commit;
