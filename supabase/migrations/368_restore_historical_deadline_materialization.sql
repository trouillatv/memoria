-- Migration 368 — Restaure le contrat des échéances historiques perdu par la
-- redéfinition complète de materialize_historical_visit() en migration 338.
--
-- Ne recopier surtout pas la fonction entière : la migration 367 a depuis
-- ajouté le contrat pinned_for_visit. On transforme uniquement la branche
-- deadline effectivement installée et on échoue si sa forme a dérivé.

do $migration$
declare
  function_definition text;
  old_deadline_block constant text := $old$
      WHEN 'deadline' THEN
        v_due_date := (rec.source_payload->>'due_date')::date;
        IF v_due_date IS NULL THEN
          v_due_date := p_visit_date + interval '7 days';
        END IF;

        INSERT INTO public.site_deadlines (
          site_id, organization_id,
          title, constraint_text,
          due_date, status,
          created_by
        ) VALUES (
          p_site_id, v_org_id,
          v_eff_label,
          v_eff_desc,
          v_due_date,
          'to_plan',
          p_user_id
        ) RETURNING id INTO v_entity_id;
$old$;
  new_deadline_block constant text := $new$
      WHEN 'deadline' THEN
        -- Une date n'est matérialisée que si le document fournit une valeur ISO
        -- explicite. Une date relative/non prouvée reste une contrainte à planifier.
        v_due_date := CASE
          WHEN COALESCE(rec.source_payload->>'dueDate', rec.source_payload->>'due_date')
               ~ '^\d{4}-\d{2}-\d{2}$'
          THEN (COALESCE(rec.source_payload->>'dueDate', rec.source_payload->>'due_date'))::date
          ELSE NULL
        END;

        INSERT INTO public.site_deadlines (
          site_id, organization_id, report_id,
          title, constraint_text,
          due_date, status,
          created_from, created_by
        ) VALUES (
          p_site_id, v_org_id, v_report_id,
          v_eff_label,
          v_eff_desc,
          v_due_date,
          CASE WHEN v_due_date IS NOT NULL THEN 'planned' ELSE 'to_plan' END,
          'historical_import', p_user_id
        ) RETURNING id INTO v_entity_id;
$new$;
begin
  select pg_get_functiondef(p.oid)
    into function_definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'materialize_historical_visit'
     and pg_get_function_identity_arguments(p.oid) = 'p_run_id uuid, p_user_id uuid, p_site_id uuid, p_visit_date date, p_visit_title text';

  if function_definition is null then
    raise exception 'materialize_historical_visit(uuid,uuid,uuid,date,text) introuvable';
  end if;

  if position('created_from, created_by' in function_definition) > 0
     and position('rec.source_payload->>''dueDate''' in function_definition) > 0
     and position('WHEN v_due_date IS NOT NULL THEN ''planned''' in function_definition) > 0 then
    return;
  end if;

  if position(old_deadline_block in function_definition) = 0 then
    raise exception 'Bloc deadline materialize_historical_visit inattendu — migration 368 non appliquée';
  end if;

  function_definition := replace(function_definition, old_deadline_block, new_deadline_block);
  execute function_definition;
end
$migration$;

comment on function public.materialize_historical_visit(uuid, uuid, uuid, date, text) is
  'Matérialise atomiquement une visite historique. Les deadlines conservent report_id/created_from, acceptent dueDate/due_date et n''inventent jamais visit_date + 7 jours.';
