-- Migration 374 — 7B-1a : restaure `report_id` sur la branche ACTION du RPC
-- materialize_historical_visit().
--
-- Régression : la branche action a perdu report_id dès la migration 273
-- (« fix_materialize_action_columns »), propagée par 297/336/337/338, jamais
-- restaurée — alors que `v_report_id` est déjà connu dans la fonction (il vient
-- de l'INSERT du site_report). La réserve a été restaurée en 297, l'échéance en
-- 368 ; l'action restait la seule branche cassée. Conséquence : toute action
-- importée après le backfill ponctuel 288 naît avec report_id = null (BELLA), ce
-- qui casse en cascade la provenance objet→source (7A), le graphe causal Mémoire
-- et la projection canonical (indexée sur report_id).
--
-- Correctif purement provenance : on copie un identifiant déjà connu au moment de
-- l'écriture. AUCUN changement de statut/logique métier. N'affecte QUE les FUTURES
-- matérialisations — l'existant relève d'un backfill séparé (7B-3), non inclus ici.
--
-- Pattern sûr (cf. migration 368) : on NE recopie PAS la fonction entière (367 a
-- ajouté le contrat pinned_for_visit, 368 le contrat deadline). On lit la
-- définition live et on remplace UNIQUEMENT la branche action ; on échoue si sa
-- forme a dérivé.

do $migration$
declare
  function_definition text;
  old_action_block constant text := $old$WHEN 'action' THEN
        INSERT INTO public.site_actions (
          site_id, organization_id,
          title, body,
          corps_etat,
          due_date, assigned_to, created_by
        ) VALUES (
          p_site_id, v_org_id,
          v_eff_label,
          v_eff_desc,
          rec.source_payload->>'corps_etat',
          (rec.source_payload->>'due_date')::date,
          rec.source_payload->>'responsible_party',
          p_user_id
        ) RETURNING id INTO v_entity_id;$old$;
  new_action_block constant text := $new$WHEN 'action' THEN
        INSERT INTO public.site_actions (
          site_id, organization_id, report_id,
          title, body,
          corps_etat,
          due_date, assigned_to, created_by
        ) VALUES (
          p_site_id, v_org_id, v_report_id,
          v_eff_label,
          v_eff_desc,
          rec.source_payload->>'corps_etat',
          (rec.source_payload->>'due_date')::date,
          rec.source_payload->>'responsible_party',
          p_user_id
        ) RETURNING id INTO v_entity_id;$new$;
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

  -- Idempotence : déjà corrigée (report_id présent dans la branche action).
  if position(new_action_block in function_definition) > 0 then
    return;
  end if;

  if position(old_action_block in function_definition) = 0 then
    raise exception 'Bloc action materialize_historical_visit inattendu — migration 374 non appliquée (forme dérivée)';
  end if;

  function_definition := replace(function_definition, old_action_block, new_action_block);
  execute function_definition;
end
$migration$;
