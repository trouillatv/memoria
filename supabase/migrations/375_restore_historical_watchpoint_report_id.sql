-- Migration 375 — 7B-1c : restaure `report_id` sur la branche OBSERVATION du RPC
-- materialize_historical_visit().
--
-- Régression : la branche observation (→ site_watchpoints) n'a jamais posé
-- report_id, alors que `v_report_id` est déjà connu dans la fonction (il vient
-- de l'INSERT du site_report) et que la colonne existe (le writer natif
-- `createWatchpoint` la remplit). Seul le backfill ponctuel 288 avait rattrapé
-- les imports antérieurs ; tout import postérieur (BELLA 9/9, OCEF Compostage
-- 104/104, Vila Dovant 3/3, Ocef4 3/3) naît avec report_id = null. C'était la
-- dernière fuite courante d'un report_id connu (gate transversale 7B, 2026-09-02) :
-- action restaurée en 374, réserve en 297, échéance en 368, décision jamais
-- perdue ; l'observation restait la seule branche cassée.
--
-- Correctif purement provenance : on copie un identifiant déjà connu au moment de
-- l'écriture. AUCUN changement de statut/logique métier, AUCUNE autre famille
-- touchée. N'affecte QUE les FUTURES matérialisations — l'existant relève d'un
-- backfill séparé (non inclus ici), qui ne s'exécutera qu'après ce writer fermé.
--
-- Pattern sûr (cf. migrations 368/374) : on NE recopie PAS la fonction entière.
-- On lit la définition live et on remplace UNIQUEMENT la branche observation ;
-- on échoue si sa forme a dérivé.

do $migration$
declare
  function_definition text;
  old_observation_block constant text := $old$WHEN 'observation' THEN
        INSERT INTO public.site_watchpoints (
          site_id, organization_id,
          title, body,
          confirmed_by
        ) VALUES (
          p_site_id, v_org_id,
          v_eff_label,
          v_eff_desc,
          p_user_id
        ) RETURNING id INTO v_entity_id;$old$;
  new_observation_block constant text := $new$WHEN 'observation' THEN
        INSERT INTO public.site_watchpoints (
          site_id, organization_id, report_id,
          title, body,
          confirmed_by
        ) VALUES (
          p_site_id, v_org_id, v_report_id,
          v_eff_label,
          v_eff_desc,
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

  -- Idempotence : déjà corrigée (report_id présent dans la branche observation).
  if position(new_observation_block in function_definition) > 0 then
    return;
  end if;

  if position(old_observation_block in function_definition) = 0 then
    raise exception 'Bloc observation materialize_historical_visit inattendu — migration 375 non appliquée (forme dérivée)';
  end if;

  function_definition := replace(function_definition, old_observation_block, new_observation_block);
  execute function_definition;
end
$migration$;
