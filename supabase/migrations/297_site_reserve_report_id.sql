-- Migration 297 — Lier les réserves historiques à leur visite source
--
-- Problème :
--   site_reserve n'a pas de report_id. Les réserves créées par
--   materialize_historical_visit() ne peuvent donc pas être rattachées
--   à leur visite historique (site_report origin='import'). Conséquences :
--   · les réserves historiques apparaissent comme cartes individuelles dans
--     la Frise au lieu d'être absorbées dans le chapitre de la visite ;
--   · readMaterializedCountsByReport() ne peut pas les compter.
--
-- Solution :
--   1. Ajouter report_id (nullable) à site_reserve.
--   2. Backfill des réserves existantes via document_proposal_materialization.
--   3. Mettre à jour materialize_historical_visit() pour passer v_report_id.

-- ── 1. Colonne report_id ──────────────────────────────────────────────────────

ALTER TABLE public.site_reserve
  ADD COLUMN IF NOT EXISTS report_id uuid
    REFERENCES public.site_reports(id)
    ON DELETE SET NULL;

-- ── 2. Backfill via document_proposal_materialization ────────────────────────
-- Chemin : site_reserve.id → dpm.target_entity_id
--        → dpm.proposal_id → dep.id
--        → dep.extraction_run_id → sr.extraction_run_id
--        → sr.id (site_reports)

UPDATE public.site_reserve rv
SET report_id = sr.id
FROM public.document_proposal_materialization dpm
JOIN public.document_extraction_proposal dep ON dep.id = dpm.proposal_id
JOIN public.site_reports sr ON sr.extraction_run_id = dep.extraction_run_id
WHERE dpm.target_entity_type = 'site_reserve'
  AND dpm.target_entity_id = rv.id
  AND rv.report_id IS NULL;

-- ── 3. Mettre à jour materialize_historical_visit() ──────────────────────────

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
  v_doc_filename text;
  v_entity_id  uuid;
  v_eff_label  text;
  v_eff_desc   text;
  v_due_date   date;
  v_has_kf     boolean := false;
  rec          record;
BEGIN
  -- IDEMPOTENCE : si la visite existe déjà pour ce run, on la retourne sans rien toucher.
  SELECT id INTO v_report_id
    FROM public.site_reports
    WHERE extraction_run_id = p_run_id;
  IF FOUND THEN RETURN v_report_id; END IF;

  -- Métadonnées du run + nom du document pour fallback
  SELECT r.organization_id, r.document_id, d.filename
    INTO v_org_id, v_doc_id, v_doc_filename
    FROM public.document_extraction_run r
    JOIN public.documents d ON d.id = r.document_id
    WHERE r.id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % introuvable', p_run_id;
  END IF;

  -- tenant_id du site (single-tenant pilot : une seule valeur par org)
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

  -- ── Lier le document PV à la visite ──────────────────────────────────────
  INSERT INTO public.document_links (
    document_id,
    target_type,
    target_id
  ) VALUES (
    v_doc_id,
    'site_report',
    v_report_id
  )
  ON CONFLICT (document_id, target_type, target_id) DO NOTHING;

  -- ── Matérialisation des propositions acceptées / éditées ──────────────────
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
          created_by,
          report_id
        ) VALUES (
          p_site_id, v_org_id,
          v_eff_label,
          p_visit_date,
          rec.source_payload->>'issued_by',
          p_user_id,
          v_report_id
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          materialized_at, materialized_by
        ) VALUES (
          v_org_id, rec.id, 'site_reserve', v_entity_id, now(), p_user_id
        ) ON CONFLICT DO NOTHING;

      WHEN 'action' THEN
        INSERT INTO public.site_actions (
          site_id, organization_id,
          title, description,
          corps_etat,
          deadline, issued_by, created_by
        ) VALUES (
          p_site_id, v_org_id,
          v_eff_label,
          v_eff_desc,
          rec.source_payload->>'corps_etat',
          (rec.source_payload->>'due_date')::date,
          rec.source_payload->>'responsible_party',
          p_user_id
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          materialized_at, materialized_by
        ) VALUES (
          v_org_id, rec.id, 'site_action', v_entity_id, now(), p_user_id
        ) ON CONFLICT DO NOTHING;

      WHEN 'decision' THEN
        INSERT INTO public.site_decisions (
          site_id, organization_id,
          report_id,
          title, description,
          source, status,
          decided_at, created_by
        ) VALUES (
          p_site_id, v_org_id,
          v_report_id,
          v_eff_label,
          v_eff_desc,
          'historical_import',
          'validated',
          p_visit_date,
          p_user_id
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          materialized_at, materialized_by
        ) VALUES (
          v_org_id, rec.id, 'site_decision', v_entity_id, now(), p_user_id
        ) ON CONFLICT DO NOTHING;

      WHEN 'observation' THEN
        INSERT INTO public.site_watchpoints (
          site_id, organization_id,
          title, description,
          raised_at, raised_by, created_by
        ) VALUES (
          p_site_id, v_org_id,
          v_eff_label,
          v_eff_desc,
          p_visit_date,
          rec.source_payload->>'responsible_party',
          p_user_id
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          materialized_at, materialized_by
        ) VALUES (
          v_org_id, rec.id, 'site_watchpoint', v_entity_id, now(), p_user_id
        ) ON CONFLICT DO NOTHING;

      WHEN 'deadline' THEN
        v_due_date := (rec.source_payload->>'due_date')::date;
        IF v_due_date IS NULL THEN
          v_due_date := p_visit_date + interval '7 days';
        END IF;

        INSERT INTO public.site_deadlines (
          site_id, organization_id,
          title, description,
          due_date, status,
          created_by
        ) VALUES (
          p_site_id, v_org_id,
          v_eff_label,
          v_eff_desc,
          v_due_date,
          'pending',
          p_user_id
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          materialized_at, materialized_by
        ) VALUES (
          v_org_id, rec.id, 'site_deadline', v_entity_id, now(), p_user_id
        ) ON CONFLICT DO NOTHING;

      ELSE
        RAISE WARNING 'Famille de proposition inconnue: %', rec.proposal_family;
    END CASE;

    UPDATE public.document_extraction_proposal
      SET review_status = 'materialized'
      WHERE id = rec.id;
  END LOOP;

  SELECT EXISTS (
    SELECT 1
      FROM public.document_extraction_proposal
      WHERE extraction_run_id = p_run_id
        AND proposal_family = 'knowledge_fact'
        AND review_status IN ('accepted', 'edited')
  ) INTO v_has_kf;

  UPDATE public.document_extraction_run
    SET status = CASE WHEN v_has_kf THEN 'partially_materialized' ELSE 'materialized' END
    WHERE id = p_run_id;

  RETURN v_report_id;
END;
$$;

COMMENT ON COLUMN public.site_reserve.report_id IS
  'Visite source (site_reports) pour les réserves issues d''un PV historique. '
  'NULL pour les réserves saisies manuellement.';
