-- Migration 282 — Correction mismatch camelCase dans materialize_historical_visit().
--
-- L'extracteur LLM produit des clés camelCase dans source_payload (dueDate, responsibleParty…).
-- La migration 278 lisait ces champs en snake_case (due_date) → toujours NULL.
--
-- Champs corrigés :
--   action   : source_payload->>'due_date'  → COALESCE(->>'dueDate', ->>'due_date')
--   deadline : source_payload->>'due_date'  → COALESCE(->>'dueDate', ->>'due_date')
--
-- Compatibilité descendante : COALESCE lit d'abord camelCase (nouvelles extractions),
-- puis snake_case (données antérieures éventuelles). Aucune perte.
--
-- Autres champs audités :
--   issued_by (reservation)  : absent du schéma Zod → toujours NULL, comportement inchangé.
--   date_decision (decision) : absent du schéma Zod → fallback p_visit_date, comportement inchangé.
--   constraint_text (deadline): absent du schéma Zod → toujours NULL, comportement inchangé.

CREATE OR REPLACE FUNCTION public.materialize_historical_visit(
  p_run_id      uuid,
  p_user_id     uuid,
  p_site_id     uuid,
  p_visit_date  date,
  p_visit_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id      uuid;
  v_org_id         uuid;
  v_tenant_id      uuid;
  v_doc_id         uuid;
  v_is_canonical   boolean;
  v_target_site_id uuid;
  v_doc_deleted_at timestamptz;
  v_entity_id      uuid;
  v_eff_label      text;
  v_eff_desc       text;
  v_due_date       date;
  v_has_kf         boolean := false;
  rec              record;
BEGIN
  -- ── GARDES PRÉ-MATÉRIALISATION ────────────────────────────────────────────

  SELECT der.organization_id, der.document_id, der.is_canonical, der.target_site_id,
         d.deleted_at
    INTO v_org_id, v_doc_id, v_is_canonical, v_target_site_id, v_doc_deleted_at
    FROM public.document_extraction_run der
    JOIN public.documents d ON d.id = der.document_id
    WHERE der.id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % introuvable', p_run_id;
  END IF;

  IF NOT v_is_canonical THEN
    RAISE EXCEPTION
      'Matérialisation refusée : le run % n''est pas canonique (is_canonical = false). '
      'Seul le run canonique d''un document peut être matérialisé.',
      p_run_id;
  END IF;

  IF v_target_site_id IS DISTINCT FROM p_site_id THEN
    RAISE EXCEPTION
      'Matérialisation refusée : le run % appartient au chantier %, pas au chantier %.',
      p_run_id, v_target_site_id, p_site_id;
  END IF;

  IF v_doc_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Matérialisation refusée : le document source du run % a été supprimé (deleted_at = %).',
      p_run_id, v_doc_deleted_at;
  END IF;

  -- ── IDEMPOTENCE ───────────────────────────────────────────────────────────
  SELECT id INTO v_report_id
    FROM public.site_reports
    WHERE extraction_run_id = p_run_id;
  IF FOUND THEN RETURN v_report_id; END IF;

  SELECT tenant_id INTO v_tenant_id
    FROM public.sites
    WHERE id = p_site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Site % introuvable', p_site_id;
  END IF;

  -- ── Création de la visite historique ──────────────────────────────────────
  INSERT INTO public.site_reports (
    site_id, tenant_id, organization_id,
    status, origin,
    text_input,
    started_at,
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
      'Visite importée — ' || to_char(p_visit_date, 'DD/MM/YYYY')
    ),
    p_visit_date::timestamptz,
    v_doc_id,
    p_run_id,
    p_user_id
  )
  RETURNING id INTO v_report_id;

  -- ── Matérialisation des propositions acceptées / éditées ──────────────────
  -- knowledge_fact, person, company → ignorés ici (pipeline TypeScript post-RPC)
  FOR rec IN
    SELECT *
      FROM public.document_extraction_proposal
      WHERE extraction_run_id = p_run_id
        AND review_status IN ('accepted', 'edited')
        AND proposal_family NOT IN ('knowledge_fact', 'person', 'company')
    ORDER BY created_at
  LOOP
    v_eff_label := COALESCE(rec.reviewed_label, rec.label);
    v_eff_desc  := COALESCE(rec.reviewed_description, rec.description);
    v_entity_id := NULL;

    CASE rec.proposal_family

      WHEN 'reservation' THEN
        INSERT INTO public.site_reserve (
          site_id, organization_id,
          label, issued_on, issued_by,
          created_by
        ) VALUES (
          p_site_id, v_org_id,
          v_eff_label,
          p_visit_date,
          rec.source_payload->>'issued_by',
          p_user_id
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          status, created_by
        ) VALUES (
          v_org_id, rec.id,
          'site_reserve', v_entity_id,
          'done', p_user_id
        ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

      WHEN 'action' THEN
        -- Correction 282 : l'extracteur produit dueDate (camelCase).
        -- COALESCE assure la compatibilité avec d'éventuelles données antérieures en snake_case.
        v_due_date := CASE
          WHEN COALESCE(rec.source_payload->>'dueDate', rec.source_payload->>'due_date') IS NOT NULL
          THEN (COALESCE(rec.source_payload->>'dueDate', rec.source_payload->>'due_date'))::date
          ELSE NULL
        END;
        INSERT INTO public.site_actions (
          site_id, report_id,
          title, body,
          due_date,
          created_by, created_from
        ) VALUES (
          p_site_id, v_report_id,
          v_eff_label, v_eff_desc,
          v_due_date,
          p_user_id, 'historical_import'
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          status, created_by
        ) VALUES (
          v_org_id, rec.id,
          'site_action', v_entity_id,
          'done', p_user_id
        ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

      WHEN 'decision' THEN
        INSERT INTO public.site_decisions (
          site_id, report_id,
          titre, description,
          date_decision,
          source,
          created_by
        ) VALUES (
          p_site_id, v_report_id,
          v_eff_label, v_eff_desc,
          COALESCE(
            CASE WHEN rec.source_payload->>'date_decision' IS NOT NULL
              THEN (rec.source_payload->>'date_decision')::date
              ELSE NULL
            END,
            p_visit_date
          ),
          'historical_import',
          p_user_id
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          status, created_by
        ) VALUES (
          v_org_id, rec.id,
          'site_decision', v_entity_id,
          'done', p_user_id
        ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

      WHEN 'observation' THEN
        INSERT INTO public.site_report_proposals (
          report_id, type, status,
          short_label, payload
        ) VALUES (
          v_report_id, 'vigilance', 'accepted',
          v_eff_label,
          jsonb_build_object('description', COALESCE(v_eff_desc, ''))
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          status, created_by
        ) VALUES (
          v_org_id, rec.id,
          'site_report_proposal', v_entity_id,
          'done', p_user_id
        ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

      WHEN 'deadline' THEN
        -- Correction 282 : même correction dueDate pour les échéances.
        v_due_date := CASE
          WHEN COALESCE(rec.source_payload->>'dueDate', rec.source_payload->>'due_date') IS NOT NULL
          THEN (COALESCE(rec.source_payload->>'dueDate', rec.source_payload->>'due_date'))::date
          ELSE NULL
        END;
        INSERT INTO public.site_deadlines (
          site_id, organization_id, report_id,
          title, constraint_text, due_date,
          status,
          created_from, created_by
        ) VALUES (
          p_site_id, v_org_id, v_report_id,
          v_eff_label,
          rec.source_payload->>'constraint_text',
          v_due_date,
          CASE WHEN v_due_date IS NOT NULL THEN 'planned' ELSE 'to_plan' END,
          'historical_import', p_user_id
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          status, created_by
        ) VALUES (
          v_org_id, rec.id,
          'site_deadline', v_entity_id,
          'done', p_user_id
        ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

      ELSE
        CONTINUE;

    END CASE;

    UPDATE public.document_extraction_proposal
      SET review_status = 'materialized',
          reviewed_at   = COALESCE(reviewed_at, now())
      WHERE id = rec.id;

  END LOOP;

  SELECT EXISTS (
    SELECT 1
      FROM public.document_extraction_proposal
      WHERE extraction_run_id = p_run_id
        AND review_status IN ('accepted', 'edited')
        AND proposal_family IN ('knowledge_fact', 'person', 'company')
  ) INTO v_has_kf;

  UPDATE public.document_extraction_run
    SET status       = CASE WHEN v_has_kf THEN 'partially_materialized' ELSE 'materialized' END,
        completed_at = COALESCE(completed_at, now())
    WHERE id = p_run_id;

  RETURN v_report_id;
END;
$$;

COMMENT ON FUNCTION public.materialize_historical_visit(uuid, uuid, uuid, date, text) IS
  'Crée atomiquement une visite historique importée depuis un run d''extraction IA. '
  'Retourne site_reports.id. Idempotent (UNIQUE extraction_run_id). '
  'Gardes : is_canonical=true, target_site_id=p_site_id, document non supprimé. '
  'knowledge_fact / person / company ignorés : traitement post-RPC en TypeScript. '
  'Mig 282 : dueDate camelCase (COALESCE avec due_date pour compatibilité descendante).';
