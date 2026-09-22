-- Migration 430 — Restaure trois contrats de materialize_historical_visit()
-- silencieusement annulés par la migration 429.
--
-- INCIDENT : 429 a réécrit le corps entier de la fonction en repartant du texte
-- de la migration 338 (« reprise à l'identique du corps de la fonction »,
-- cf. en-tête de 429), au lieu de patcher la définition LIVE. Or trois
-- correctifs postérieurs à 338 n'avaient JAMAIS été reportés dans 338 lui-même
-- et n'existaient donc que dans la définition live installée en base :
--   - 374 : report_id sur la branche action (provenance objet→source, requis
--     par projectCanonicalSubjectSafely et attachHistoricalReportEntitiesTo-
--     CanonicalBusinessObjects, tous deux filtrés `.eq('report_id', ...)`).
--   - 368 : report_id/created_from sur les échéances, parsing strict ISO de
--     due_date (jamais de date fabriquée à p_visit_date + 7 jours), statut
--     conditionnel planned/to_plan.
--   - 367 : filtre `pinned_for_visit = true` sur la matérialisation photo
--     (une preuve visuelle non épinglée ne doit jamais devenir une visit_capture).
-- 429 a donc régressé silencieusement les trois contrats. Conséquence directe :
-- toute action/échéance historique matérialisée depuis le déploiement de 429
-- naît avec report_id = null, ce qui casse en cascade les DEUX seuls mécanismes
-- automatiques de réparation de canonical_subject_id.
--
-- CORRECTIF : même pattern sûr que 367/368/374 — on lit la définition LIVE via
-- pg_get_functiondef, on vérifie que chaque bloc attendu est présent (échec
-- bruyant si sa forme a dérivé), on remplace UNIQUEMENT les trois blocs ciblés,
-- puis on exécute une seule fois. Le transfert atomique is_canonical introduit
-- par 429 (UPDATE document_extraction_run ... is_canonical, juste avant le
-- RETURN de la branche nominale) n'est touché par AUCUN des trois blocs
-- remplacés ci-dessous : il reste strictement intact, y compris sa garde
-- d'idempotence (la branche de RETURN anticipé ne le traverse jamais).
--
-- DOCTRINE PERMANENTE (à respecter par toute modification future de cette
-- fonction, cf. mandat Vincent 2026-09-22 sur cet incident) :
--   1. Ne jamais recopier une ancienne définition de fonction pour en repartir.
--   2. Préférer un patch ciblé et gardé (pattern pg_get_functiondef ci-dessus)
--      à une réécriture complète.
--   3. Si une réécriture complète est réellement nécessaire, la baser sur la
--      définition LIVE actuelle (pg_get_functiondef), jamais sur une migration
--      historique arbitraire.
--   4. Toute modification de cette fonction doit rester verte sur la suite de
--      contrat permanente tests/lib/db/materialize-historical-visit-contract.test.ts
--      (report_id action, contrat 368 complet, pinned_for_visit, promotion
--      canonique 429, non-réappropriation de l'autorité sur rejeu idempotent),
--      pas seulement sur le nouveau comportement visé.
--   5. Une migration touchant cette fonction doit énoncer explicitement, dans
--      son en-tête, quels invariants elle doit préserver.
-- Une modification future qui casse report_id, les échéances ou les photos
-- doit être détectée AVANT déploiement par ce test, pas découverte a posteriori
-- dans les données.

do $migration$
declare
  function_definition text;

  old_action_block constant text := $old_action$WHEN 'action' THEN
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
        ) RETURNING id INTO v_entity_id;$old_action$;
  new_action_block constant text := $new_action$WHEN 'action' THEN
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
        ) RETURNING id INTO v_entity_id;$new_action$;

  old_deadline_block constant text := $old_deadline$
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
$old_deadline$;
  new_deadline_block constant text := $new_deadline$
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
$new_deadline$;

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

  -- Chaque contrat est vérifié et restauré indépendamment : idempotent si déjà
  -- présent, échec bruyant si le bloc attendu a dérivé (jamais de correctif
  -- approximatif). Les trois `if` sont évalués sur `function_definition` avant
  -- toute substitution pour ne dépendre que de l'état réellement installé.

  -- 1. Action — report_id (migration 374)
  if position(new_action_block in function_definition) = 0 then
    if position(old_action_block in function_definition) = 0 then
      raise exception 'Bloc action materialize_historical_visit inattendu — migration 430 ne peut pas restaurer le contrat 374 (forme dérivée)';
    end if;
    function_definition := replace(function_definition, old_action_block, new_action_block);
  end if;

  -- 2. Deadline — report_id/created_from/parsing strict/status (migration 368)
  if position('created_from, created_by' in function_definition) = 0
     or position('rec.source_payload->>''dueDate''' in function_definition) = 0
     or position('WHEN v_due_date IS NOT NULL THEN ''planned''' in function_definition) = 0 then
    if position(old_deadline_block in function_definition) = 0 then
      raise exception 'Bloc deadline materialize_historical_visit inattendu — migration 430 ne peut pas restaurer le contrat 368 (forme dérivée)';
    end if;
    function_definition := replace(function_definition, old_deadline_block, new_deadline_block);
  end if;

  -- 3. Photos — pinned_for_visit (migration 367)
  if position('AND dee.pinned_for_visit = true' in function_definition) = 0 then
    if position(old_visual_filter in function_definition) = 0 then
      raise exception 'Bloc visuel materialize_historical_visit inattendu — migration 430 ne peut pas restaurer le contrat 367 (forme dérivée)';
    end if;
    function_definition := replace(function_definition, old_visual_filter, new_visual_filter);
  end if;

  execute function_definition;
end
$migration$;

comment on function public.materialize_historical_visit(uuid, uuid, uuid, date, text) is
  'Crée atomiquement une visite historique importée + tous ses artefacts métier. '
  'Utilise le nom du fichier PV comme titre par défaut. '
  'Lie automatiquement le document PV à la visite via document_links. '
  'Contrats restaurés par la migration 430 après régression silencieuse introduite par 429 : '
  'report_id sur les actions (374), report_id/created_from/parsing ISO strict de due_date/statut '
  'conditionnel sur les échéances (368), filtre pinned_for_visit sur les photos (367) — le transfert '
  'is_canonical atomique (429) reste intact et inchangé par cette migration. '
  'DOCTRINE PERMANENTE : toute modification future de cette fonction doit patcher la définition LIVE '
  '(pg_get_functiondef) par bloc gardé et rester verte sur '
  'tests/lib/db/materialize-historical-visit-contract.test.ts — jamais repartir d''une ancienne '
  'migration comme source de vérité (voir incident documenté en tête de ce fichier).';
