-- 239 — Sépare explicitement la branche DELETE du trigger 238.
-- Cela évite toute référence à NEW, qui n'existe pas pour une suppression.

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
  if tg_op = 'DELETE' then
    if old.status = 'active' and old.role = 'admin' then
      perform 1
      from public.organizations
      where id = old.organization_id
      for update;

      select count(*) into v_remaining_admins
      from public.organization_memberships om
      where om.organization_id = old.organization_id
        and om.status = 'active'
        and om.role = 'admin'
        and om.id <> old.id;

      if v_remaining_admins = 0 then
        raise exception using
          errcode = 'P0001',
          message = 'organization_membership_last_admin',
          detail = 'The last active organization administrator cannot be removed, suspended, or downgraded';
      end if;
    end if;
    return old;
  end if;

  if old.status = 'active'
     and old.role = 'admin'
     and (
       new.status is distinct from 'active'
       or new.role is distinct from 'admin'
       or new.organization_id is distinct from old.organization_id
     ) then
    perform 1
    from public.organizations
    where id = old.organization_id
    for update;

    select count(*) into v_remaining_admins
    from public.organization_memberships om
    where om.organization_id = old.organization_id
      and om.status = 'active'
      and om.role = 'admin'
      and om.id <> old.id;

    if v_remaining_admins = 0 then
      raise exception using
        errcode = 'P0001',
        message = 'organization_membership_last_admin',
        detail = 'The last active organization administrator cannot be removed, suspended, or downgraded';
    end if;
  end if;

  return new;
end;
$$;

commit;
