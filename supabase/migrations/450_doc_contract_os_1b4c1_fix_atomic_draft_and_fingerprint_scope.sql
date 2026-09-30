-- ============================================================
-- 450 — DOC-CONTRACT-OS-1B4-C1 FIX (revue ChatGPT indépendante,
-- FIX_REQUIRED sur l'implémentation issue de la migration 449).
-- ============================================================
-- Corrige DEUX défauts d'architecture relevés en revue, tous deux dans le
-- périmètre STRICT de 449 (planning_impact_application_decisions) — aucune
-- table Planning n'est touchée, aucune mutation Planning n'est introduite,
-- 1B4-C2 (Apply réel) reste HOLD.

-- ── FIX 4 — createDraftDecision atomique ────────────────────────────────────
--
-- Avant ce correctif, lib/db/planning-impact-application-decisions.ts
-- exécutait la supersession de l'ancienne décision (UPDATE) puis l'insertion
-- de la nouvelle (INSERT) en DEUX appels Supabase-JS séparés — chacun se
-- commit seul. Un échec de l'INSERT (contrainte, réseau, conflit) laissait
-- l'ancienne décision déjà marquée 'superseded' SANS aucune décision active
-- de remplacement : exactement le défaut d'atomicité déjà corrigé pour
-- Planning en migration 444 (fn_plan_save_published_cycle_exclusive /
-- fn_plan_supersede_cycle_exclusive), non reproduit ici à tort.
--
-- fn_planning_application_decision_create_draft fait TOUT dans le corps
-- d'UNE fonction PL/pgSQL — une seule transaction Postgres implicite par
-- appel RPC : un échec à n'importe quelle étape (y compris l'INSERT final)
-- fait ROLLBACK aussi la supersession qui la précède, sans code de rollback
-- explicite à écrire (garantie native de la fonction).
--
-- pg_advisory_xact_lock, verrouillé sur hashtextextended(proposal_id) et
-- relâché automatiquement à la fin de la transaction, sérialise deux appels
-- concurrents pour la MÊME proposition — une simple `SELECT ... FOR UPDATE`
-- ne protège rien quand AUCUNE ligne active n'existe encore à verrouiller
-- (premier draft d'une proposition, cas le plus fréquent).
--
-- Idempotence (mandat §4) : si une décision active (draft/ready) porte déjà
-- EXACTEMENT le même application_fingerprint, aucune nouvelle ligne n'est
-- créée, aucune supersession n'a lieu — la même décision logique est
-- retournée telle quelle (`idempotent: true`).
create or replace function public.fn_planning_application_decision_create_draft(
  p_organization_id uuid,
  p_site_id uuid,
  p_engagement_id uuid,
  p_contract_effect_id uuid,
  p_planning_impact_proposal_id uuid,
  p_proposal_version_at_decision integer,
  p_mutation_kind text,
  p_target_mission_id uuid,
  p_target_source_kind text,
  p_target_template_id uuid,
  p_target_cycle_id uuid,
  p_decision_payload jsonb,
  p_application_fingerprint text,
  p_planning_state_fingerprint text,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_match_id uuid;
  v_supersedes_id uuid;
  v_result public.planning_impact_application_decisions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_planning_impact_proposal_id::text, 0));

  v_match_id := null;
  v_supersedes_id := null;
  for v_row in
    select id, application_fingerprint
    from public.planning_impact_application_decisions
    where planning_impact_proposal_id = p_planning_impact_proposal_id
      and status in ('draft', 'ready')
    order by created_at desc
    for update
  loop
    if v_supersedes_id is null then
      v_supersedes_id := v_row.id;
    end if;
    if v_match_id is null and v_row.application_fingerprint = p_application_fingerprint then
      v_match_id := v_row.id;
    end if;
  end loop;

  if v_match_id is not null then
    select * into v_result
    from public.planning_impact_application_decisions
    where id = v_match_id;
    return jsonb_build_object('idempotent', true, 'decision', to_jsonb(v_result));
  end if;

  update public.planning_impact_application_decisions
     set status = 'superseded', updated_at = now()
   where planning_impact_proposal_id = p_planning_impact_proposal_id
     and status in ('draft', 'ready');

  begin
    insert into public.planning_impact_application_decisions (
      organization_id, site_id, engagement_id, contract_effect_id,
      planning_impact_proposal_id, proposal_version_at_decision,
      mutation_kind, target_mission_id, target_source_kind, target_template_id, target_cycle_id,
      decision_payload, application_fingerprint, planning_state_fingerprint,
      status, supersedes_decision_id, created_by
    ) values (
      p_organization_id, p_site_id, p_engagement_id, p_contract_effect_id,
      p_planning_impact_proposal_id, p_proposal_version_at_decision,
      p_mutation_kind, p_target_mission_id, p_target_source_kind, p_target_template_id, p_target_cycle_id,
      p_decision_payload, p_application_fingerprint, p_planning_state_fingerprint,
      'draft', v_supersedes_id, p_created_by
    )
    returning * into v_result;
  exception
    when unique_violation then
      raise exception 'PLANNING_APPLICATION_DECISION_DUPLICATE_FINGERPRINT' using errcode = 'P0001';
  end;

  return jsonb_build_object('idempotent', false, 'decision', to_jsonb(v_result));
end;
$$;

-- Même doctrine que mig 443/444 : primitive interne, jamais exécutable
-- directement par anon/authenticated — seul le code serveur (service_role,
-- via createAdminClient) l'appelle.
revoke execute on function public.fn_planning_application_decision_create_draft(
  uuid, uuid, uuid, uuid, uuid, integer, text, uuid, text, uuid, uuid, jsonb, text, text, uuid
) from public;
revoke execute on function public.fn_planning_application_decision_create_draft(
  uuid, uuid, uuid, uuid, uuid, integer, text, uuid, text, uuid, uuid, jsonb, text, text, uuid
) from anon;
revoke execute on function public.fn_planning_application_decision_create_draft(
  uuid, uuid, uuid, uuid, uuid, integer, text, uuid, text, uuid, uuid, jsonb, text, text, uuid
) from authenticated;
grant execute on function public.fn_planning_application_decision_create_draft(
  uuid, uuid, uuid, uuid, uuid, integer, text, uuid, text, uuid, uuid, jsonb, text, text, uuid
) to service_role;

-- ── FIX 5 — contrainte unique compatible avec le cycle de vie ───────────────
--
-- L'ancienne contrainte UNIQUE(contract_effect_id, application_fingerprint)
-- (mig 449) bloquait indéfiniment la recréation d'une décision identique
-- après un cancelled/superseded — limitation documentée à l'époque comme
-- acceptable "en C1" mais non nécessaire : un index partiel restreint aux
-- statuts actifs/applicables suffit à préserver l'idempotence sur les
-- décisions VIVANTES sans jamais geler l'historique révolu.
alter table public.planning_impact_application_decisions
  drop constraint planning_impact_application_decisions_fingerprint_unique;

create unique index planning_impact_application_decisions_fingerprint_active_uidx
  on public.planning_impact_application_decisions (contract_effect_id, application_fingerprint)
  where status in ('draft', 'ready', 'applied');

comment on index public.planning_impact_application_decisions_fingerprint_active_uidx is
  'Remplace planning_impact_application_decisions_fingerprint_unique (mig 449, mandat FIX 5). Scope aux statuts actifs/applicables (draft/ready/applied) : une décision cancelled/superseded ne bloque plus la recréation d''une décision identique.';

comment on column public.planning_impact_application_decisions.application_fingerprint is
  'hash(schemaVersion=APPLICATION_DECISION_SCHEMA_VERSION + contract_effect_id + planning_impact_proposal_id + proposal_version_at_decision + mutation_kind + target_mission_id + target_source_kind + target_template_id + target_cycle_id + decision_payload canonisé) — EXCLUT tout champ volatil (id/status/timestamps/decided_by). Le schemaVersion (mandat FIX 5) garantit qu''une décision calculée sous un schéma antérieur n''est jamais confondue avec une décision identique calculée sous le schéma courant. UNIQUE avec contract_effect_id parmi les statuts draft/ready/applied uniquement (index partiel, cf. planning_impact_application_decisions_fingerprint_active_uidx).';
