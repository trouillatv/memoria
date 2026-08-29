-- Migration 367 — La sélection photo de la revue doit être le contrat de
-- matérialisation. Une preuve visuelle non épinglée ne devient jamais une
-- visit_capture lors de l'import d'une visite historique.
--
-- La fonction complète a connu plusieurs corrections de colonnes (336–338).
-- Pour ne pas recopier puis figer accidentellement une ancienne variante, cette
-- migration transforme la définition effectivement installée, avec deux gardes :
-- idempotence si le filtre existe déjà, HARD FAIL si le bloc attendu a dérivé.

do $migration$
declare
  function_definition text;
  old_visual_filter constant text :=
    'AND dee.storage_path IS NOT NULL' || E'\n' ||
    '      AND dee.evidence_type IN (''image'', ''page_snapshot'')';
  new_visual_filter constant text :=
    'AND dee.storage_path IS NOT NULL' || E'\n' ||
    '      AND dee.pinned_for_visit = true' || E'\n' ||
    '      AND dee.evidence_type IN (''image'', ''page_snapshot'')';
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

  if position('AND dee.pinned_for_visit = true' in function_definition) > 0 then
    return;
  end if;

  if position(old_visual_filter in function_definition) = 0 then
    raise exception 'Bloc visuel materialize_historical_visit inattendu — migration 367 non appliquée';
  end if;

  function_definition := replace(function_definition, old_visual_filter, new_visual_filter);
  execute function_definition;
end
$migration$;

comment on function public.materialize_historical_visit(uuid, uuid, uuid, date, text) is
  'Matérialise atomiquement une visite historique. Les visit_capture photo proviennent uniquement des preuves image/page_snapshot explicitement épinglées (pinned_for_visit=true).';

