-- Migration 337 — Corrige les colonnes du registre document_proposal_materialization
-- dans materialize_historical_visit(), pour les 5 branches de la CASE (reservation,
-- action, decision, observation, deadline).
--
-- Erreur observée à l'import d'un PV historique (bouton "Créer la visite
-- historique"), après la migration 336 : column "materialized_at" of relation
-- "document_proposal_materialization" does not exist.
--
-- La table réelle (voir lib/supabase/database.types.ts, généré depuis le schéma
-- vivant) n'a jamais eu de colonnes materialized_at/materialized_by : ses
-- colonnes sont status/error_message/created_at/created_by. Le code applicatif
-- équivalent (recordMaterialization() dans lib/db/document-extractions.ts)
-- écrit status: 'done'. Cette régression existe depuis la migration 272 (jamais
-- exercée avec succès pour aucune famille de proposition avant ce correctif),
-- et a simplement été recopiée telle quelle par les migrations 297, 298 et 336.
--
-- Cette migration ne touche que les 5 INSERT INTO document_proposal_materialization ;
-- le reste de la fonction (dont le fix du bloc action de la 336 et la boucle
-- photos de la 298) est repris à l'identique.

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
  v_att_id     uuid;
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
          status, created_by
        ) VALUES (
          v_org_id, rec.id, 'site_reserve', v_entity_id, 'done', p_user_id
        ) ON CONFLICT DO NOTHING;

      WHEN 'action' THEN
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
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          status, created_by
        ) VALUES (
          v_org_id, rec.id, 'site_action', v_entity_id, 'done', p_user_id
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
          status, created_by
        ) VALUES (
          v_org_id, rec.id, 'site_decision', v_entity_id, 'done', p_user_id
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
          status, created_by
        ) VALUES (
          v_org_id, rec.id, 'site_watchpoint', v_entity_id, 'done', p_user_id
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
          status, created_by
        ) VALUES (
          v_org_id, rec.id, 'site_deadline', v_entity_id, 'done', p_user_id
        ) ON CONFLICT DO NOTHING;

      ELSE
        RAISE WARNING 'Famille de proposition inconnue: %', rec.proposal_family;
    END CASE;

    UPDATE public.document_extraction_proposal
      SET review_status = 'materialized'
      WHERE id = rec.id;
  END LOOP;

  -- ── Matérialisation des photos : une photo = une capture ──────────────────
  -- Chaque image extraite du PV (evidence_type = 'image' | 'page_snapshot')
  -- devient une visit_capture (kind='photo', source='historical_import').
  FOR rec IN
    SELECT DISTINCT ON (dee.storage_path)
      dee.storage_path,
      dee.caption,
      dee.source_page
    FROM public.document_extraction_evidence dee
    WHERE dee.extraction_run_id = p_run_id
      AND dee.storage_path IS NOT NULL
      AND dee.evidence_type IN ('image', 'page_snapshot')
    ORDER BY dee.storage_path, dee.source_page NULLS LAST
  LOOP
    -- Attachement (idempotent via index unique sra_report_storage_path_uq)
    INSERT INTO public.site_report_attachments (
      report_id, kind, storage_path, filename, created_at
    ) VALUES (
      v_report_id, 'photo',
      rec.storage_path,
      split_part(rec.storage_path, '/', -1),
      p_visit_date::timestamptz
    )
    ON CONFLICT (report_id, storage_path) WHERE storage_path IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_att_id;

    -- Si conflit : récupérer l'id de l'attachement existant
    IF v_att_id IS NULL THEN
      SELECT id INTO v_att_id
      FROM public.site_report_attachments
      WHERE report_id = v_report_id AND storage_path = rec.storage_path;
    END IF;

    -- Capture (idempotent via NOT EXISTS sur attachment_id)
    INSERT INTO public.visit_capture (
      site_id, organization_id, report_id,
      kind, status, source,
      body, attachment_id,
      created_at, updated_at
    )
    SELECT
      p_site_id, v_org_id, v_report_id,
      'photo', 'processed', 'historical_import',
      rec.caption, v_att_id,
      p_visit_date::timestamptz, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.visit_capture vc
      WHERE vc.attachment_id = v_att_id
    );
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

COMMENT ON FUNCTION public.materialize_historical_visit IS
  'Crée atomiquement une visite historique importée + tous ses artefacts métier. '
  'Utilise le nom du fichier PV comme titre par défaut. '
  'Lie automatiquement le document PV à la visite via document_links. '
  '(337 : corrige les 5 INSERT INTO document_proposal_materialization — status/created_by '
  'au lieu de materialized_at/materialized_by, régression présente depuis la 272)';
