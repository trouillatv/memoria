-- Synchronise users.role → auth.users.app_metadata.role pour usage dans le JWT

create or replace function public.sync_user_role_to_jwt()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  update auth.users
     set raw_app_meta_data =
       coalesce(raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object('role', new.role::text)
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_user_role_change on public.users;
create trigger on_user_role_change
  after insert or update of role on public.users
  for each row
  execute function public.sync_user_role_to_jwt();

-- Trigger pour s'assurer qu'une row public.users existe pour chaque auth.users
-- créé. Utilise les metadata user_metadata si disponibles.
create or replace function public.handle_new_auth_user()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'chef_equipe')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();
