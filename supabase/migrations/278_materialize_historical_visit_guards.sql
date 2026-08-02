-- Migration 278 — Gardes de sécurité dans materialize_historical_visit().
--
-- Problème : la fonction acceptait n'importe quel run_id valide, y compris un run
-- non canonique. En conséquence, deux runs différents d'un même document auraient
-- pu créer deux site_reports distincts, contournant l'invariant métier.
--
-- Corrections :
--   1. Vérifier que le run est canonique (is_canonical = true).
--   2. Vérifier que le run appartient bien au chantier attendu (target_site_id).
--   3. Vérifier que le document source est actif (deleted_at IS NULL).
--
-- La chaîne de garanties SQL est désormais fermée :
--   mig 277 UNIQUE(document_id) WHERE is_canonical      → 1 run canonique / document
--   ce guard is_canonical                                → seuls les canoniques matérialisables
--   sr_extraction_run_uidx UNIQUE(extraction_run_id)    → 1 site_report / run
--   ⟹ 1 document historique → au plus 1 site_report historique (garanti en DB)
--
-- Contrainte (site_id, source_document_id) WHERE origin='import' :
--   redondante grâce à la chaîne ci-dessus, mais utile comme filet de sécurité direct.
--   Non appliquée dans cette migration car des données test (OCEF2, Ocef3) présentent
--   des violations issues de re-matérialisations croisées. À créer après nettoyage de
--   ces sites test.
--   Forme attendue :
--     CREATE UNIQUE INDEX sr_site_source_doc_import_uidx
--       ON public.site_reports (site_id, source_document_id)
--       WHERE origin = 'import' AND source_document_id IS NOT NULL;
--
-- Dette de provenance site_reserve :
--   site_reserve n'a pas de report_id — les réserves historiques ne peuvent pas
--   remonter directement à leur site_report source. À traiter dans un lot ultérieur.

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

  -- Récupère les métadonnées du run et du document en une seule passe
  SELECT der.organization_id, der.document_id, der.is_canonical, der.target_site_id,
         d.deleted_at
    INTO v_org_id, v_doc_id, v_is_canonical, v_target_site_id, v_doc_deleted_at
    FROM public.document_extraction_run der
    JOIN public.documents d ON d.id = der.document_id
    WHERE der.id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % introuvable', p_run_id;
  END IF;

  -- Guard 1 : le run doit être canonique
  IF NOT v_is_canonical THEN
    RAISE EXCEPTION
      'Matérialisation refusée : le run % n''est pas canonique (is_canonical = false). '
      'Seul le run canonique d''un document peut être matérialisé.',
      p_run_id;
  END IF;

  -- Guard 2 : le run doit appartenir au chantier demandé
  IF v_target_site_id IS DISTINCT FROM p_site_id THEN
    RAISE EXCEPTION
      'Matérialisation refusée : le run % appartient au chantier %, pas au chantier %.',
      p_run_id, v_target_site_id, p_site_id;
  END IF;

  -- Guard 3 : le document source ne doit pas être soft-deleted
  IF v_doc_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Matérialisation refusée : le document source du run % a été supprimé (deleted_at = %).',
      p_run_id, v_doc_deleted_at;
  END IF;

  -- ── IDEMPOTENCE ───────────────────────────────────────────────────────────
  -- Si la visite existe déjà pour ce run, on la retourne sans rien toucher.
  SELECT id INTO v_report_id
    FROM public.site_reports
    WHERE extraction_run_id = p_run_id;
  IF FOUND THEN RETURN v_report_id; END IF;

  -- tenant_id du site
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
  'Gardes : is_canonical=true, target_site_id=p_site_id, document non supprimé. '
  'knowledge_fact / person / company ignorés : traitement post-RPC en TypeScript.';
