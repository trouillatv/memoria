-- Migration 262 — Deux corrections sur la matérialisation historique.
--
-- 1. OBSERVATIONS (family='observation') allaient dans site_report_proposals
--    (table des propositions MemorIA en cours de visite) au lieu de site_watchpoints
--    (les points de vigilance affichés). Le RPC est corrigé.
--
-- 2. BACKFILL : les 4 observations déjà créées par la visite OCEF sont migrées
--    vers site_watchpoints. Les entrées de site_report_proposals sont conservées
--    en l'état (traçabilité) mais les watchpoints deviennent la source d'affichage.

-- ── 1. Backfill : vigilances existantes des imports → site_watchpoints ────────

INSERT INTO public.site_watchpoints (
  organization_id,
  site_id,
  report_id,
  title,
  body,
  status,
  created_at
)
SELECT
  s.organization_id,
  sr.site_id,
  srp.report_id,
  srp.short_label,
  srp.payload->>'description',
  'active',
  srp.created_at
FROM public.site_report_proposals srp
JOIN public.site_reports sr ON sr.id = srp.report_id
JOIN public.sites s ON s.id = sr.site_id
WHERE srp.type = 'vigilance'
  AND sr.origin = 'import'
ON CONFLICT DO NOTHING;

-- ── 2. RPC mis à jour — observation → site_watchpoints ───────────────────────

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
  v_report_id  uuid;
  v_org_id     uuid;
  v_tenant_id  uuid;
  v_doc_id     uuid;
  v_entity_id  uuid;
  v_eff_label  text;
  v_eff_desc   text;
  v_due_date   date;
  v_has_kf     boolean := false;
  rec          record;
BEGIN
  -- IDEMPOTENCE
  SELECT id INTO v_report_id
    FROM public.site_reports
    WHERE extraction_run_id = p_run_id;
  IF FOUND THEN RETURN v_report_id; END IF;

  SELECT organization_id, document_id
    INTO v_org_id, v_doc_id
    FROM public.document_extraction_run
    WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % introuvable', p_run_id;
  END IF;

  SELECT tenant_id INTO v_tenant_id
    FROM public.sites
    WHERE id = p_site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Site % introuvable', p_site_id;
  END IF;

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

  -- knowledge_fact, person, company → pipeline TypeScript post-RPC
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
        v_due_date := CASE
          WHEN rec.source_payload->>'due_date' IS NOT NULL
          THEN (rec.source_payload->>'due_date')::date
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

      -- CORRIGÉ : observation → site_watchpoints (pas site_report_proposals)
      WHEN 'observation' THEN
        INSERT INTO public.site_watchpoints (
          organization_id, site_id, report_id,
          title, body,
          status
        ) VALUES (
          v_org_id, p_site_id, v_report_id,
          v_eff_label, v_eff_desc,
          'active'
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          status, created_by
        ) VALUES (
          v_org_id, rec.id,
          'site_watchpoint', v_entity_id,
          'done', p_user_id
        ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

      WHEN 'deadline' THEN
        v_due_date := CASE
          WHEN rec.source_payload->>'due_date' IS NOT NULL
          THEN (rec.source_payload->>'due_date')::date
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
  'Observations → site_watchpoints (mig 262). '
  'knowledge_fact / person / company ignorés : traitement post-RPC en TypeScript.';
