-- PLAN-INTEG-1 — FINAL ATOMIC SWITCH FIX (review ChatGPT du SHA
-- f564aa298f47335a7f62ffb4a5a14206aa9834f3, mandat Vincent 2026-09-27).
--
-- Bug #2 restait à moitié corrigé : toute écriture qui ABOUTIT à 'published'
-- finissait par appeler `fn_plan_publish_cycle_exclusive`, mais les mutations
-- qui la PRÉCÈDENT (UPDATE de planning_cycles, remplacement des cases,
-- régénération) s'exécutaient en appels Supabase-JS séparés — chacun se commit
-- seul. Un échec après le début de la séquence laissait l'ancien roulement déjà
-- muté, sans rollback :
--   réécriture publiée→publiée : update cycle → replace slots → regenerate →
--     PUIS publish RPC ;
--   supersede publié : clore l'ancien → regenerate l'ancien → créer le
--     successeur en brouillon → replace slots → regenerate → PUIS publish RPC
--     du successeur.
-- Deux transactions atomiques successives ne constituent PAS une transaction
-- atomique globale.
--
-- Ces deux RPC couvrent l'UNIQUE cas où un roulement déjà PUBLIÉ change d'état
-- en restant/devenant publié : la réécriture sur place, et le versionnement
-- (supersede). Chacune fait TOUT — champs, cases, exclusivité SIMPLE/ROULEMENT,
-- régénération — dans UNE seule transaction Postgres (le corps de la fonction).
-- Elles réutilisent `fn_plan_regenerate_cycle_templates` (mig 442) et
-- `plan_integ_periods_overlap` (mig 442) ; elles reproduisent l'ORDRE exact de
-- `fn_plan_publish_cycle_exclusive` : vérifier le conflit SIMPLE → lever si non
-- confirmé → archiver le SIMPLE conflictuel SI confirmé → ENSUITE seulement
-- publier/insérer avec status='published'. Le trigger de contrainte
-- `plan_integ_cycle_guard` (mig 442) est `deferrable initially immediate` : il
-- vérifie l'exclusivité juste après l'instruction qui pose status='published',
-- donc tout SIMPLE conflictuel doit déjà être archivé À CE MOMENT-LÀ, jamais
-- après.
--
-- Les autres transitions (brouillon→publié pour la première fois, publié→
-- brouillon, brouillon→brouillon) ne changent pas : elles n'ont soit aucun état
-- publié préexistant à corrompre, soit un seul appel déjà atomique
-- (`fn_plan_regenerate_cycle_templates`) — hors du périmètre de ce correctif.
--
-- Additif, idempotent (`create or replace`). Rollback : DROP des 2 fonctions.

-- ─── Réécriture d'un roulement déjà PUBLIÉ, en place ────────────────────────
create or replace function public.fn_plan_save_published_cycle_exclusive(
  p_cycle_id uuid,
  p_name text,
  p_cycle_length_weeks smallint,
  p_anchor_date date,
  p_starts_on date,
  p_ends_on date,
  p_mission_id uuid,
  p_slots jsonb,
  p_confirm_replace_simple boolean default false,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.planning_cycles%rowtype;
  v_mission_ids uuid[];
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

  if v_cycle.status <> 'published' then
    raise exception 'PLAN_INTEG_CYCLE_NOT_PUBLISHED' using errcode = 'P0001';
  end if;

  -- Verrou de la/des mission(s) concernées, ordre déterministe (id croissant)
  -- pour ne jamais dépendre du sens de l'appel — évite un deadlock si deux
  -- écritures concurrentes croisent les mêmes deux missions.
  v_mission_ids := array(
    select distinct m from unnest(array[v_cycle.mission_id, p_mission_id]) as m order by m
  );
  perform 1 from public.missions where id = any(v_mission_ids) order by id for update;

  select count(*)
    into v_simple_count
  from public.intervention_templates t
  where t.mission_id = p_mission_id
    and t.deleted_at is null
    and t.active is true
    and t.cycle_id is null
    and public.plan_integ_periods_overlap(t.starts_on, t.ends_on, p_starts_on, p_ends_on);

  if v_simple_count > 0 and not p_confirm_replace_simple then
    raise exception 'PLAN_INTEG_REPLACE_SIMPLE_REQUIRED'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'mission_id', p_mission_id,
              'cycle_id', p_cycle_id,
              'active_simple_templates', v_simple_count
            )::text;
  end if;

  if v_simple_count > 0 then
    update public.intervention_templates t
       set deleted_at = now(),
           active = false
     where t.mission_id = p_mission_id
       and t.deleted_at is null
       and t.active is true
       and t.cycle_id is null
       and public.plan_integ_periods_overlap(t.starts_on, t.ends_on, p_starts_on, p_ends_on);
  end if;

  update public.planning_cycles
     set name = left(p_name, 200),
         cycle_length_weeks = p_cycle_length_weeks,
         anchor_date = p_anchor_date,
         starts_on = p_starts_on,
         ends_on = p_ends_on,
         mission_id = p_mission_id,
         status = 'published',
         updated_by = p_actor_id,
         updated_at = now()
   where id = p_cycle_id
     and deleted_at is null;

  -- La grille est remplacée en bloc : le cycle est la seule vérité. Les cases
  -- n'ont aucune descendance (pas de FK entrante) : les effacer ne détruit
  -- aucune preuve.
  delete from public.planning_cycle_slots where cycle_id = p_cycle_id;

  insert into public.planning_cycle_slots (cycle_id, week_index, weekday, team_id, state, start_time, end_time)
  select
    p_cycle_id,
    (elem->>'weekIndex')::smallint,
    (elem->>'weekday')::smallint,
    (elem->>'teamId')::uuid,
    coalesce(elem->>'state', 'work'),
    elem->>'startTime',
    elem->>'endTime'
  from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) as elem;

  v_generated := public.fn_plan_regenerate_cycle_templates(p_cycle_id, p_actor_id);

  return jsonb_build_object(
    'cycle_id', p_cycle_id,
    'mission_id', p_mission_id,
    'archived_simple_templates', v_simple_count,
    'generated_templates', v_generated
  );
end;
$$;

-- ─── Version-split d'un roulement déjà PUBLIÉ (supersede) ───────────────────
-- Clore l'ancienne version, créer la nouvelle, remplacer le SIMPLE conflictuel
-- et régénérer les DEUX projections : une seule transaction. Un échec à
-- n'importe quelle étape laisse l'ancien cycle STRICTEMENT intact (rollback
-- Postgres) — aucune ligne de successeur ne survit.
create or replace function public.fn_plan_supersede_cycle_exclusive(
  p_old_cycle_id uuid,
  p_effective_from date,
  p_site_id uuid,
  p_mission_id uuid,
  p_organization_id uuid,
  p_name text,
  p_cycle_length_weeks smallint,
  p_anchor_date date,
  p_ends_on date,
  p_slots jsonb,
  p_confirm_replace_simple boolean default false,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.planning_cycles%rowtype;
  v_mission_ids uuid[];
  v_old_ends_on date;
  v_simple_count integer := 0;
  v_new_cycle_id uuid;
  v_generated_old integer := 0;
  v_generated_new integer := 0;
begin
  select *
    into v_old
  from public.planning_cycles
  where id = p_old_cycle_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'PLAN_INTEG_CYCLE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_old.status <> 'published' then
    raise exception 'PLAN_INTEG_CYCLE_NOT_PUBLISHED' using errcode = 'P0001';
  end if;

  v_mission_ids := array(
    select distinct m from unnest(array[v_old.mission_id, p_mission_id]) as m order by m
  );
  perform 1 from public.missions where id = any(v_mission_ids) order by id for update;

  -- 1. Clore l'ancienne version — sa grille reste EXACTEMENT ce qu'elle était.
  --    Borner un roulement publié à une date plus proche ne peut pas créer de
  --    nouveau conflit SIMPLE (une période plus étroite ne chevauche jamais
  --    plus qu'une période plus large ne le faisait déjà) : aucune vérification
  --    d'exclusivité n'est nécessaire ici.
  v_old_ends_on := p_effective_from - 1;

  update public.planning_cycles
     set ends_on = v_old_ends_on,
         updated_by = p_actor_id,
         updated_at = now()
   where id = p_old_cycle_id
     and deleted_at is null;

  v_generated_old := public.fn_plan_regenerate_cycle_templates(p_old_cycle_id, p_actor_id);

  -- 2. Le SIMPLE conflictuel sur la période de la NOUVELLE version, AVANT de
  --    créer sa ligne : le trigger d'exclusivité vérifie juste après l'INSERT
  --    qui pose status='published'.
  select count(*)
    into v_simple_count
  from public.intervention_templates t
  where t.mission_id = p_mission_id
    and t.deleted_at is null
    and t.active is true
    and t.cycle_id is null
    and public.plan_integ_periods_overlap(t.starts_on, t.ends_on, p_effective_from, p_ends_on);

  if v_simple_count > 0 and not p_confirm_replace_simple then
    raise exception 'PLAN_INTEG_REPLACE_SIMPLE_REQUIRED'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'mission_id', p_mission_id,
              'old_cycle_id', p_old_cycle_id,
              'active_simple_templates', v_simple_count
            )::text;
  end if;

  if v_simple_count > 0 then
    update public.intervention_templates t
       set deleted_at = now(),
           active = false
     where t.mission_id = p_mission_id
       and t.deleted_at is null
       and t.active is true
       and t.cycle_id is null
       and public.plan_integ_periods_overlap(t.starts_on, t.ends_on, p_effective_from, p_ends_on);
  end if;

  -- 3. La nouvelle version, déjà PUBLIÉE — jamais un brouillon intermédiaire
  --    publié par un second appel séparé.
  insert into public.planning_cycles (
    site_id,
    mission_id,
    organization_id,
    name,
    cycle_length_weeks,
    anchor_date,
    starts_on,
    ends_on,
    status,
    supersedes_cycle_id,
    created_by
  ) values (
    p_site_id,
    p_mission_id,
    p_organization_id,
    left(p_name, 200),
    p_cycle_length_weeks,
    p_anchor_date,
    p_effective_from,
    p_ends_on,
    'published',
    p_old_cycle_id,
    p_actor_id
  )
  returning id into v_new_cycle_id;

  insert into public.planning_cycle_slots (cycle_id, week_index, weekday, team_id, state, start_time, end_time)
  select
    v_new_cycle_id,
    (elem->>'weekIndex')::smallint,
    (elem->>'weekday')::smallint,
    (elem->>'teamId')::uuid,
    coalesce(elem->>'state', 'work'),
    elem->>'startTime',
    elem->>'endTime'
  from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) as elem;

  v_generated_new := public.fn_plan_regenerate_cycle_templates(v_new_cycle_id, p_actor_id);

  return jsonb_build_object(
    'old_cycle_id', p_old_cycle_id,
    'new_cycle_id', v_new_cycle_id,
    'mission_id', p_mission_id,
    'archived_simple_templates', v_simple_count,
    'generated_templates_old', v_generated_old,
    'generated_templates_new', v_generated_new
  );
end;
$$;

-- Même doctrine que mig 443 : primitives internes, jamais exécutables
-- directement par anon/authenticated.
revoke execute on function public.fn_plan_save_published_cycle_exclusive(
  uuid, text, smallint, date, date, date, uuid, jsonb, boolean, uuid
) from public;
revoke execute on function public.fn_plan_save_published_cycle_exclusive(
  uuid, text, smallint, date, date, date, uuid, jsonb, boolean, uuid
) from anon;
revoke execute on function public.fn_plan_save_published_cycle_exclusive(
  uuid, text, smallint, date, date, date, uuid, jsonb, boolean, uuid
) from authenticated;
grant execute on function public.fn_plan_save_published_cycle_exclusive(
  uuid, text, smallint, date, date, date, uuid, jsonb, boolean, uuid
) to service_role;

revoke execute on function public.fn_plan_supersede_cycle_exclusive(
  uuid, date, uuid, uuid, uuid, text, smallint, date, date, jsonb, boolean, uuid
) from public;
revoke execute on function public.fn_plan_supersede_cycle_exclusive(
  uuid, date, uuid, uuid, uuid, text, smallint, date, date, jsonb, boolean, uuid
) from anon;
revoke execute on function public.fn_plan_supersede_cycle_exclusive(
  uuid, date, uuid, uuid, uuid, text, smallint, date, date, jsonb, boolean, uuid
) from authenticated;
grant execute on function public.fn_plan_supersede_cycle_exclusive(
  uuid, date, uuid, uuid, uuid, text, smallint, date, date, jsonb, boolean, uuid
) to service_role;
