-- Migration 414 - materialisation incrementale des visites historiques.
--
-- Le produit autorise la creation d'une visite historique alors que des propositions
-- restent pending. Le RPC ne doit donc pas retourner silencieusement des qu'un
-- site_report existe deja : il doit reutiliser ce report et materialiser les
-- propositions accepted/edited qui n'ont pas encore de document_proposal_materialization.
--
-- Patch chirurgical : on modifie la definition live avec pg_get_functiondef afin de
-- conserver les contrats poses apres la migration 338 (photos epinglees, deadlines,
-- report_id des actions/observations, etc.).

do $migration$
declare
  function_definition text;
  before_definition text;

  old_report_insert constant text := $old$  INSERT INTO public.site_reports (
    site_id, tenant_id, organization_id,
    status, origin,
    text_input,
    source_document_id, extraction_run_id,
    created_by
  ) VALUES (
    p_site_id,
    v_tenant_id,
    v_org_id,
    'curated',
    'import',
    COALESCE(
      NULLIF(trim(p_visit_title), ''),
      regexp_replace(v_doc_filename, '\.pdf$', '', 'i'),
      'Visite historique du ' || to_char(p_visit_date, 'DD/MM/YYYY')
    ),
    v_doc_id,
    p_run_id,
    p_user_id
  )
  RETURNING id INTO v_report_id;$old$;

  new_report_insert constant text := $new$  IF v_report_id IS NULL THEN
    INSERT INTO public.site_reports (
      site_id, tenant_id, organization_id,
      status, origin,
      text_input,
      source_document_id, extraction_run_id,
      created_by
    ) VALUES (
      p_site_id,
      v_tenant_id,
      v_org_id,
      'curated',
      'import',
      COALESCE(
        NULLIF(trim(p_visit_title), ''),
        regexp_replace(v_doc_filename, '\.pdf$', '', 'i'),
        'Visite historique du ' || to_char(p_visit_date, 'DD/MM/YYYY')
      ),
      v_doc_id,
      p_run_id,
      p_user_id
    )
    RETURNING id INTO v_report_id;
  END IF;$new$;

  old_loop_filter constant text := $old$      WHERE extraction_run_id = p_run_id
        AND review_status IN ('accepted', 'edited')
        AND proposal_family NOT IN ('knowledge_fact', 'person', 'company')$old$;

  new_loop_filter constant text := $new$      WHERE extraction_run_id = p_run_id
        AND review_status IN ('accepted', 'edited')
        AND proposal_family NOT IN ('knowledge_fact', 'person', 'company')
        AND NOT EXISTS (
          SELECT 1
            FROM public.document_proposal_materialization dpm
            WHERE dpm.proposal_id = document_extraction_proposal.id
        )$new$;
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

  -- Idempotence de migration.
  if position('IF v_report_id IS NULL THEN' in function_definition) > 0
     and position('dpm.proposal_id = document_extraction_proposal.id' in function_definition) > 0 then
    return;
  end if;

  before_definition := function_definition;
  function_definition := regexp_replace(
    function_definition,
    'IF FOUND THEN\s+RETURN v_report_id;\s+END IF;',
    $replacement$IF FOUND THEN
    -- Report existant : on continue avec ce v_report_id afin de materialiser
    -- incrementellement les propositions acceptees plus tard.
  END IF;$replacement$
  );
  if function_definition = before_definition then
    raise exception 'Bloc idempotence materialize_historical_visit inattendu - migration 414 non appliquee';
  end if;

  if position(old_report_insert in function_definition) = 0 then
    raise exception 'Bloc creation site_report materialize_historical_visit inattendu - migration 414 non appliquee';
  end if;
  function_definition := replace(function_definition, old_report_insert, new_report_insert);

  if position(old_loop_filter in function_definition) = 0 then
    raise exception 'Bloc filtre propositions materialize_historical_visit inattendu - migration 414 non appliquee';
  end if;
  function_definition := replace(function_definition, old_loop_filter, new_loop_filter);

  execute function_definition;
end
$migration$;

comment on function public.materialize_historical_visit(uuid, uuid, uuid, date, text) is
  'Visite historique incrementale : cree le site_report si absent, sinon reutilise le report existant '
  'et materialise uniquement les propositions accepted/edited non encore liees dans document_proposal_materialization.';
