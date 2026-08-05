-- Migration 298 — Photos des PV historiques dans visit_capture
--
-- Doctrine : « une photo = une capture ».
-- Les photos extraites des PV historiques doivent alimenter le patrimoine
-- photo du chantier exactement comme les photos terrain — même table, même
-- infrastructure, même galerie, même compteur.
--
-- Avant cette migration :
--   • Les images sont stockées dans Supabase Storage (chemin : snapshots/...).
--   • Elles sont référencées dans document_extraction_evidence.storage_path.
--   • Elles ne sont PAS dans visit_capture → compteur = 0 partout.
--
-- Après cette migration :
--   • Chaque image extraite d'un PV crée une entrée dans site_report_attachments
--     (même mécanisme que les photos terrain).
--   • Puis une entrée dans visit_capture (kind='photo', source='historical_import',
--     status='processed') liée à l'attachement.
--   • Les compteurs (Frise, patrimoine, « depuis votre dernier passage »,
--     galerie future) sont automatiquement corrects.
--
-- Chemin de données :
--   site_reports (origin='import', extraction_run_id = R)
--   → document_extraction_evidence (extraction_run_id = R, evidence_type='image'|'page_snapshot')
--   → storage_path (image déjà uploadée dans Supabase Storage)

-- ── 1. Colonne source dans visit_capture ─────────────────────────────────────
-- Provenance explicite : le patrimoine reste unique, le filtre reste possible.

ALTER TABLE public.visit_capture
  ADD COLUMN IF NOT EXISTS source text
  CHECK (source IS NULL OR source IN (
    'field_visit',       -- photo prise pendant une visite terrain (défaut, null OK)
    'historical_import', -- photo extraite d'un PV historique
    'meeting',           -- photo d'une réunion / CR
    'document'           -- photo d'un document autonome
  ));

COMMENT ON COLUMN public.visit_capture.source IS
  'Provenance de la capture. NULL = visite terrain classique (champ optionnel, '
  'rétrocompatible). historical_import = extraite d''un PV historique par le '
  'pipeline d''extraction. Permet de filtrer par source sans changer le modèle.';

-- ── 2. Index d'idempotence sur site_report_attachments ───────────────────────
-- Garantit qu'on ne duplique pas un attachement si la migration est rejouée.

CREATE UNIQUE INDEX IF NOT EXISTS sra_report_storage_path_uq
  ON public.site_report_attachments (report_id, storage_path)
  WHERE storage_path IS NOT NULL;

-- ── 3. Backfill — PV historiques déjà importés ───────────────────────────────

-- 3a. Créer les site_report_attachments manquants (un par image unique par PV)
INSERT INTO public.site_report_attachments (
  report_id, kind, storage_path, filename, created_at
)
SELECT DISTINCT ON (sr.id, dee.storage_path)
  sr.id,
  'photo',
  dee.storage_path,
  split_part(dee.storage_path, '/', -1),
  COALESCE(sr.started_at, sr.created_at)
FROM public.site_reports sr
JOIN public.document_extraction_evidence dee
  ON dee.extraction_run_id = sr.extraction_run_id
WHERE sr.origin = 'import'
  AND sr.extraction_run_id IS NOT NULL
  AND dee.storage_path IS NOT NULL
  AND dee.evidence_type IN ('image', 'page_snapshot')
ORDER BY sr.id, dee.storage_path, dee.source_page NULLS LAST
ON CONFLICT (report_id, storage_path) WHERE storage_path IS NOT NULL
DO NOTHING;

-- 3b. Créer les visit_capture manquants pour ces attachements
INSERT INTO public.visit_capture (
  site_id, organization_id, report_id,
  kind, status, source,
  body, attachment_id,
  created_at, updated_at
)
SELECT
  sr.site_id,
  sr.organization_id,
  sra.report_id,
  'photo',
  'processed',
  'historical_import',
  dee.caption,
  sra.id,
  COALESCE(sr.started_at, sr.created_at),
  now()
FROM public.site_report_attachments sra
JOIN public.site_reports sr ON sr.id = sra.report_id
JOIN public.document_extraction_evidence dee
  ON dee.extraction_run_id = sr.extraction_run_id
  AND dee.storage_path = sra.storage_path
WHERE sr.origin = 'import'
  AND sra.kind = 'photo'
  AND NOT EXISTS (
    SELECT 1 FROM public.visit_capture vc
    WHERE vc.attachment_id = sra.id
  );

-- ── 4. Mettre à jour materialize_historical_visit() ──────────────────────────
-- Ajoute la boucle photos après la matérialisation des propositions.

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
