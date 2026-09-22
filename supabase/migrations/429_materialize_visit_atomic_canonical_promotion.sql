-- Migration 429 — la promotion du run canonique devient ATOMIQUE avec la
-- matérialisation, au lieu d'un appel TypeScript best-effort séparé après coup.
--
-- Constat (revue Vincent sur d6435d95, P0 Unicité) : promoteCanonicalExtractionRun
-- était appelé en `.catch(() => {})` juste après materialize_historical_visit().
-- Si la matérialisation réussissait et que la promotion échouait (réseau, RPC
-- indisponible, etc.), on retombait exactement dans l'état que le P0 cherche à
-- éliminer : visite matérialisée, mais l'ancien run ready_for_review reste
-- is_canonical=true. is_canonical est l'autorité documentaire, pas un détail
-- accessoire — son transfert ne peut pas rester best-effort.
--
-- Correction : le transfert is_canonical est déplacé DANS materialize_historical_visit(),
-- avant chaque RETURN (idempotent ou nominal). Une fonction PL/pgSQL SECURITY DEFINER
-- s'exécute dans la transaction de son appelant : si une étape échoue, tout est annulé,
-- y compris la création de la visite. Il ne peut donc plus exister d'état intermédiaire
-- où la visite existe mais le mauvais run est canonique.
--
-- Reprise à l'identique du corps de la fonction (migration 338), avec deux
-- changements seulement :
--   1. La lecture des métadonnées du run (v_org_id/v_doc_id/v_doc_filename) est
--      déplacée AVANT le contrôle d'idempotence, pour disposer de v_doc_id dans
--      la branche nominale.
--   2. Ajout du transfert atomique is_canonical (même portée que
--      promote_canonical_extraction_run, migration 428 : au plus un run
--      canonique par document_id, jamais de DELETE ni de statut superseded)
--      UNIQUEMENT dans la branche nominale, juste avant le RETURN v_report_id.
--
-- Revue Vincent (429 v1) : la branche IDEMPOTENTE ne transfère PAS is_canonical.
-- « Idempotent » signifie qu'un rejeu ne change pas l'état final, y compris
-- l'autorité documentaire. Si on promouvait aussi dans cette branche, rejouer
-- materialize_historical_visit(A) après qu'un run B plus récent a été réanalysé
-- et est devenu canonique redonnerait l'autorité à A par simple replay — alors
-- que seule une NOUVELLE finalisation humaine doit pouvoir déplacer l'autorité.
-- Grâce à l'atomicité de cette même migration, la branche nominale ne peut de
-- toute façon plus échouer partiellement : un rejeu n'a donc jamais à « réparer »
-- une promotion manquée.
--
-- promote_canonical_extraction_run() (428) est conservée : elle reste utile
-- comme opération de correction ponctuelle (ex. correction du témoin historique
-- 729128ec) et pour tout appelant hors pipeline de matérialisation. Elle n'est
-- plus appelée depuis materializeHistoricalRun (lib/documents/materialize-historical-run.ts) :
-- l'appel TypeScript best-effort devenu redondant est supprimé dans le même lot.

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
  -- Métadonnées du run + nom du document — déplacé avant l'idempotence pour
  -- disposer de v_doc_id dans la branche nominale (promotion canonique).
  SELECT r.organization_id, r.document_id, d.filename
    INTO v_org_id, v_doc_id, v_doc_filename
    FROM public.document_extraction_run r
    JOIN public.documents d ON d.id = r.document_id
    WHERE r.id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % introuvable', p_run_id;
  END IF;

  -- IDEMPOTENCE : si la visite existe déjà pour ce run, on la retourne sans
  -- rejouer la matérialisation. Aucune mutation is_canonical ici : un rejeu ne
  -- doit jamais pouvoir redéplacer l'autorité documentaire (voir commentaire
  -- de tête de fichier). L'autorité éventuellement transférée depuis ce run
  -- vers un run réanalysé plus récent reste intacte.
  SELECT id INTO v_report_id
    FROM public.site_reports
    WHERE extraction_run_id = p_run_id;
  IF FOUND THEN
    RETURN v_report_id;
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
          titre, description,
          source, statut,
          date_decision, created_by
        ) VALUES (
          p_site_id, v_org_id,
          v_report_id,
          v_eff_label,
          v_eff_desc,
          'historical_import',
          'actee',
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
          title, body,
          confirmed_by
        ) VALUES (
          p_site_id, v_org_id,
          v_eff_label,
          v_eff_desc,
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

  -- ── P0 Unicité : transfert atomique du run canonique ──────────────────────
  -- La finalisation humaine (matérialisation réussie) fait autorité. Dans la
  -- MÊME transaction que la création de la visite : jamais d'état où la visite
  -- existe et où l'ancien run ready_for_review reste is_canonical=true.
  -- Uniquement ici (branche nominale) : un rejeu idempotent (ci-dessus) ne
  -- repasse jamais par ce transfert.
  UPDATE public.document_extraction_run
    SET is_canonical = false
    WHERE document_id = v_doc_id
      AND is_canonical = true
      AND id <> p_run_id;

  UPDATE public.document_extraction_run
    SET is_canonical = true
    WHERE id = p_run_id;

  RETURN v_report_id;
END;
$$;

COMMENT ON FUNCTION public.materialize_historical_visit IS
  'Crée atomiquement une visite historique importée + tous ses artefacts métier. '
  'Utilise le nom du fichier PV comme titre par défaut. '
  'Lie automatiquement le document PV à la visite via document_links. '
  '(429 : transfert is_canonical atomique avec la matérialisation, uniquement dans '
  'la branche nominale de finalisation — jamais lors d''un rejeu idempotent, et '
  'plus de promotion best-effort séparée en TypeScript)';
