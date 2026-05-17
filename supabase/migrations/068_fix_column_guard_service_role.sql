-- Migration 068 : fix trigger interventions_chef_equipe_column_guard
--
-- Bug : auth.jwt() n'est PAS null avec la service_role key (elle a un JWT,
-- juste sans app_metadata.role). Le coalesce de current_user_role() retournait
-- donc 'chef_equipe' par défaut, et le trigger écrasait assigned_team_id avec
-- l'ancienne valeur — rendant la réassignation équipe silencieusement inopérante.
--
-- Fix : ajouter auth.jwt()->>'role' = 'service_role' dans le bypass.

create or replace function public.interventions_chef_equipe_column_guard()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Bypass : connexions service_role ou non authentifiées.
  if auth.jwt() is null or (auth.jwt()->>'role') = 'service_role' then
    return new;
  end if;

  -- Seul le rôle chef_equipe est contraint en colonnes.
  if public.current_user_role() <> 'chef_equipe' then
    return new;
  end if;

  -- Colonnes structurelles : OLD wins.
  new.mission_id := old.mission_id;
  new.team := old.team;
  new.assigned_team_id := old.assigned_team_id;
  new.scheduled_at := old.scheduled_at;
  new.scheduled_for := old.scheduled_for;
  new.slot := old.slot;
  new.template_id := old.template_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;

  -- Auto-validation interdite.
  if old.status is distinct from 'validated' and new.status = 'validated' then
    new.status := old.status;
  end if;

  return new;
end;
$$;
