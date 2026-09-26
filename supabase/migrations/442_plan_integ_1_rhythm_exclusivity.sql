-- PLAN-INTEG-1 Phase B
-- Une Mission ne peut avoir qu'une source active de rythme :
--   SIMPLE (intervention_templates.cycle_id IS NULL)
--   XOR ROULEMENT (planning_cycles.status = 'published')
--
-- Doctrine :
--   planning_cycles = source metier du roulement
--   intervention_templates.cycle_id IS NOT NULL = projection technique
--
-- Les brouillons de roulement restent autorises avec un rythme simple actif.
-- Les interventions deja materialisees ne sont jamais supprimees par ces RPC.

create or replace function public.plan_integ_periods_overlap(
  a_start date,
  a_end date,
  b_start date,
  b_end date
) returns boolean
language sql
immutable
as $$
  select a_start <= coalesce(b_end, 'infinity'::date)
     and b_start <= coalesce(a_end, 'infinity'::date);
$$;

create or replace function public.plan_integ_simple_cycle_conflict_guard()
returns trigger
language plpgsql
as $$
declare
  v_conflict uuid;
begin
  if tg_table_name = 'intervention_templates' then
    if new.deleted_at is null
       and new.active is true
       and new.cycle_id is null then
      select c.id
        into v_conflict
      from public.planning_cycles c
      where c.mission_id = new.mission_id
        and c.deleted_at is null
        and c.status = 'published'
        and public.plan_integ_periods_overlap(new.starts_on, new.ends_on, c.starts_on, c.ends_on)
      limit 1;

      if v_conflict is not null then
        raise exception 'PLAN_INTEG_ACTIVE_CYCLE_CONFLICT'
          using errcode = 'P0001',
                detail = jsonb_build_object(
                  'mission_id', new.mission_id,
                  'template_id', new.id,
                  'cycle_id', v_conflict
                )::text;
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'planning_cycles' then
    if new.deleted_at is null
       and new.status = 'published' then
      select t.id
        into v_conflict
      from public.intervention_templates t
      where t.mission_id = new.mission_id
        and t.deleted_at is null
        and t.active is true
        and t.cycle_id is null
        and public.plan_integ_periods_overlap(t.starts_on, t.ends_on, new.starts_on, new.ends_on)
      limit 1;

      if v_conflict is not null then
        raise exception 'PLAN_INTEG_ACTIVE_SIMPLE_CONFLICT'
          using errcode = 'P0001',
                detail = jsonb_build_object(
                  'mission_id', new.mission_id,
                  'cycle_id', new.id,
                  'template_id', v_conflict
                )::text;
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists plan_integ_simple_guard on public.intervention_templates;
create constraint trigger plan_integ_simple_guard
after insert or update of mission_id, cycle_id, active, deleted_at, starts_on, ends_on
on public.intervention_templates
deferrable initially immediate
for each row
execute function public.plan_integ_simple_cycle_conflict_guard();

drop trigger if exists plan_integ_cycle_guard on public.planning_cycles;
create constraint trigger plan_integ_cycle_guard
after insert or update of mission_id, status, deleted_at, starts_on, ends_on
on public.planning_cycles
deferrable initially immediate
for each row
execute function public.plan_integ_simple_cycle_conflict_guard();

create or replace function public.fn_plan_regenerate_cycle_templates(
  p_cycle_id uuid,
  p_actor_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.planning_cycles%rowtype;
  v_inserted integer := 0;
begin
  select *
    into v_cycle
  from public.planning_cycles
  where id = p_cycle_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'PLAN_INTEG_CYCLE_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.intervention_templates
     set deleted_at = now(),
         active = false
   where cycle_id = p_cycle_id
     and deleted_at is null;

  if v_cycle.status <> 'published' then
    return 0;
  end if;

  insert into public.intervention_templates (
    mission_id,
    organization_id,
    cycle_id,
    title,
    frequency,
    day_of_week,
    cycle_length_weeks,
    anchor_date,
    week_index,
    assigned_team_id,
    planned_start_hhmm,
    planned_end_hhmm,
    slots,
    starts_on,
    ends_on,
    created_by,
    active
  )
  select
    v_cycle.mission_id,
    v_cycle.organization_id,
    v_cycle.id,
    left(v_cycle.name, 200),
    'weekly',
    s.weekday,
    v_cycle.cycle_length_weeks,
    v_cycle.anchor_date,
    s.week_index,
    s.team_id,
    s.start_time,
    s.end_time,
    case
      when s.start_time is null then null
      when substring(s.start_time from 1 for 2)::int < 12 then array['morning']::text[]
      when substring(s.start_time from 1 for 2)::int < 17 then array['afternoon']::text[]
      else array['evening']::text[]
    end,
    v_cycle.starts_on,
    v_cycle.ends_on,
    p_actor_id,
    true
  from public.planning_cycle_slots s
  where s.cycle_id = v_cycle.id
    and s.state = 'work';

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.fn_plan_publish_cycle_exclusive(
  p_cycle_id uuid,
  p_confirm_replace_simple boolean default false,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.planning_cycles%rowtype;
  v_simple_count integer := 0;
  v_generated integer := 0;
begin
  select *
    into v_cycle
  from public.planning_cycles
  where id = p_cycle_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'PLAN_INTEG_CYCLE_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform 1
  from public.missions
  where id = v_cycle.mission_id
  for update;

  select count(*)
    into v_simple_count
  from public.intervention_templates t
  where t.mission_id = v_cycle.mission_id
    and t.deleted_at is null
    and t.active is true
    and t.cycle_id is null
    and public.plan_integ_periods_overlap(t.starts_on, t.ends_on, v_cycle.starts_on, v_cycle.ends_on);

  if v_simple_count > 0 and not p_confirm_replace_simple then
    raise exception 'PLAN_INTEG_REPLACE_SIMPLE_REQUIRED'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'mission_id', v_cycle.mission_id,
              'cycle_id', p_cycle_id,
              'active_simple_templates', v_simple_count
            )::text;
  end if;

  if v_simple_count > 0 then
    update public.intervention_templates t
       set deleted_at = now(),
           active = false
     where t.mission_id = v_cycle.mission_id
       and t.deleted_at is null
       and t.active is true
       and t.cycle_id is null
       and public.plan_integ_periods_overlap(t.starts_on, t.ends_on, v_cycle.starts_on, v_cycle.ends_on);
  end if;

  update public.planning_cycles
     set status = 'published',
         updated_by = p_actor_id,
         updated_at = now()
   where id = p_cycle_id
     and deleted_at is null;

  v_generated := public.fn_plan_regenerate_cycle_templates(p_cycle_id, p_actor_id);

  return jsonb_build_object(
    'cycle_id', p_cycle_id,
    'mission_id', v_cycle.mission_id,
    'archived_simple_templates', v_simple_count,
    'generated_templates', v_generated
  );
end;
$$;

create or replace function public.fn_plan_create_simple_template_exclusive(
  p_mission_id uuid,
  p_title text,
  p_frequency text,
  p_slots text[] default null,
  p_day_of_week smallint default null,
  p_day_of_month smallint default null,
  p_planned_start_hhmm text default null,
  p_planned_end_hhmm text default null,
  p_starts_on date default current_date,
  p_ends_on date default null,
  p_created_by uuid default null,
  p_confirm_replace_cycle boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_cycle_count integer := 0;
  v_template_id uuid;
begin
  select organization_id
    into v_org_id
  from public.missions
  where id = p_mission_id
    and deleted_at is null
  for update;

  if not found or v_org_id is null then
    raise exception 'PLAN_INTEG_MISSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  select count(*)
    into v_cycle_count
  from public.planning_cycles c
  where c.mission_id = p_mission_id
    and c.deleted_at is null
    and c.status = 'published'
    and public.plan_integ_periods_overlap(p_starts_on, p_ends_on, c.starts_on, c.ends_on);

  if v_cycle_count > 0 and not p_confirm_replace_cycle then
    raise exception 'PLAN_INTEG_REPLACE_CYCLE_REQUIRED'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'mission_id', p_mission_id,
              'active_cycles', v_cycle_count
            )::text;
  end if;

  if v_cycle_count > 0 then
    update public.intervention_templates t
       set deleted_at = now(),
           active = false
    from public.planning_cycles c
    where t.cycle_id = c.id
      and c.mission_id = p_mission_id
      and c.deleted_at is null
      and c.status = 'published'
      and t.deleted_at is null
      and public.plan_integ_periods_overlap(p_starts_on, p_ends_on, c.starts_on, c.ends_on);

    update public.planning_cycles c
       set status = case when c.starts_on >= p_starts_on then 'stopped' else c.status end,
           ends_on = case
             when c.starts_on < p_starts_on then p_starts_on - 1
             else c.starts_on
           end,
           updated_by = p_created_by,
           updated_at = now()
     where c.mission_id = p_mission_id
       and c.deleted_at is null
       and c.status = 'published'
       and public.plan_integ_periods_overlap(p_starts_on, p_ends_on, c.starts_on, c.ends_on);
  end if;

  insert into public.intervention_templates (
    mission_id,
    organization_id,
    title,
    frequency,
    slots,
    day_of_week,
    day_of_month,
    planned_start_hhmm,
    planned_end_hhmm,
    starts_on,
    ends_on,
    created_by,
    active
  ) values (
    p_mission_id,
    v_org_id,
    left(p_title, 200),
    p_frequency,
    p_slots,
    p_day_of_week,
    p_day_of_month,
    p_planned_start_hhmm,
    p_planned_end_hhmm,
    p_starts_on,
    p_ends_on,
    p_created_by,
    true
  )
  returning id into v_template_id;

  return jsonb_build_object(
    'template_id', v_template_id,
    'mission_id', p_mission_id,
    'stopped_cycles', v_cycle_count
  );
end;
$$;

create or replace function public.fn_plan_update_simple_template_exclusive(
  p_template_id uuid,
  p_title text,
  p_frequency text,
  p_slots text[] default null,
  p_day_of_week smallint default null,
  p_day_of_month smallint default null,
  p_planned_start_hhmm text default null,
  p_planned_end_hhmm text default null,
  p_starts_on date default current_date,
  p_ends_on date default null,
  p_actor_id uuid default null,
  p_confirm_replace_cycle boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.intervention_templates%rowtype;
  v_cycle_count integer := 0;
begin
  select *
    into v_existing
  from public.intervention_templates
  where id = p_template_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'PLAN_INTEG_TEMPLATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_existing.cycle_id is not null then
    raise exception 'PLAN_INTEG_CYCLE_PROJECTION_NOT_EDITABLE' using errcode = 'P0001';
  end if;

  perform 1
  from public.missions
  where id = v_existing.mission_id
  for update;

  select count(*)
    into v_cycle_count
  from public.planning_cycles c
  where c.mission_id = v_existing.mission_id
    and c.deleted_at is null
    and c.status = 'published'
    and public.plan_integ_periods_overlap(p_starts_on, p_ends_on, c.starts_on, c.ends_on);

  if v_cycle_count > 0 and not p_confirm_replace_cycle then
    raise exception 'PLAN_INTEG_REPLACE_CYCLE_REQUIRED'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'mission_id', v_existing.mission_id,
              'template_id', p_template_id,
              'active_cycles', v_cycle_count
            )::text;
  end if;

  if v_cycle_count > 0 then
    update public.intervention_templates t
       set deleted_at = now(),
           active = false
    from public.planning_cycles c
    where t.cycle_id = c.id
      and c.mission_id = v_existing.mission_id
      and c.deleted_at is null
      and c.status = 'published'
      and t.deleted_at is null
      and public.plan_integ_periods_overlap(p_starts_on, p_ends_on, c.starts_on, c.ends_on);

    update public.planning_cycles c
       set status = case when c.starts_on >= p_starts_on then 'stopped' else c.status end,
           ends_on = case
             when c.starts_on < p_starts_on then p_starts_on - 1
             else c.starts_on
           end,
           updated_by = p_actor_id,
           updated_at = now()
     where c.mission_id = v_existing.mission_id
       and c.deleted_at is null
       and c.status = 'published'
       and public.plan_integ_periods_overlap(p_starts_on, p_ends_on, c.starts_on, c.ends_on);
  end if;

  update public.intervention_templates
     set title = left(p_title, 200),
         frequency = p_frequency,
         slots = p_slots,
         day_of_week = p_day_of_week,
         day_of_month = p_day_of_month,
         planned_start_hhmm = p_planned_start_hhmm,
         planned_end_hhmm = p_planned_end_hhmm,
         starts_on = p_starts_on,
         ends_on = p_ends_on,
         active = true
   where id = p_template_id;

  return jsonb_build_object(
    'template_id', p_template_id,
    'mission_id', v_existing.mission_id,
    'stopped_cycles', v_cycle_count
  );
end;
$$;

grant execute on function public.fn_plan_regenerate_cycle_templates(uuid, uuid) to authenticated, service_role;
grant execute on function public.fn_plan_publish_cycle_exclusive(uuid, boolean, uuid) to authenticated, service_role;
grant execute on function public.fn_plan_create_simple_template_exclusive(uuid, text, text, text[], smallint, smallint, text, text, date, date, uuid, boolean) to authenticated, service_role;
grant execute on function public.fn_plan_update_simple_template_exclusive(uuid, text, text, text[], smallint, smallint, text, text, date, date, uuid, boolean) to authenticated, service_role;
