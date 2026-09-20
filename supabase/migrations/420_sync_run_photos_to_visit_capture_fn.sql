-- Migration 420 — sync_run_photos_to_visit_capture(p_run_id)
--
-- Contexte : materialize_historical_visit() (migration 298, patchée par 367)
-- contient la boucle de matérialisation photo → visit_capture, mais elle est
-- placée APRÈS un early-return d'idempotence : si site_reports existe déjà
-- pour p_run_id (visite déjà matérialisée), la fonction retourne immédiatement
-- et ne rejoue jamais la boucle photos. Un backfill photo-only sur un run déjà
-- matérialisé ne peut donc jamais passer par materialize_historical_visit().
--
-- Cette fonction extrait exactement cette boucle (même filtre, même ordre,
-- même mécanisme d'idempotence SQL) pour qu'elle soit appelable seule, sans
-- toucher à materialize_historical_visit() ni à son early-return. Elle
-- reprend le filtre pinned_for_visit = true introduit par la migration 367.
--
-- Idempotence :
--   - site_report_attachments : ON CONFLICT (report_id, storage_path) DO NOTHING
--     (index unique sra_report_storage_path_uq, migration 298).
--   - visit_capture : INSERT ... WHERE NOT EXISTS (attachment_id).
-- Un second appel sur le même run ne crée donc aucune ligne supplémentaire.

CREATE OR REPLACE FUNCTION public.sync_run_photos_to_visit_capture(
  p_run_id uuid
)
RETURNS TABLE(attachments_created integer, captures_created integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id  uuid;
  v_org_id     uuid;
  v_site_id    uuid;
  v_visit_date timestamptz;
  v_att_id     uuid;
  v_attachments_created integer := 0;
  v_captures_created    integer := 0;
  rec record;
BEGIN
  SELECT sr.id, sr.organization_id, sr.site_id, COALESCE(sr.started_at, sr.created_at)
    INTO v_report_id, v_org_id, v_site_id, v_visit_date
    FROM public.site_reports sr
    WHERE sr.extraction_run_id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucun site_reports matérialisé pour le run % — cette fonction ne matérialise pas de visite, elle synchronise seulement les photos d''une visite déjà matérialisée.', p_run_id;
  END IF;

  FOR rec IN
    SELECT DISTINCT ON (dee.storage_path)
      dee.storage_path,
      dee.caption,
      dee.source_page
    FROM public.document_extraction_evidence dee
    WHERE dee.extraction_run_id = p_run_id
      AND dee.storage_path IS NOT NULL
      AND dee.evidence_type IN ('image', 'page_snapshot')
      AND dee.pinned_for_visit = true
    ORDER BY dee.storage_path, dee.source_page NULLS LAST
  LOOP
    v_att_id := NULL;

    INSERT INTO public.site_report_attachments (
      report_id, kind, storage_path, filename, created_at
    ) VALUES (
      v_report_id, 'photo',
      rec.storage_path,
      split_part(rec.storage_path, '/', -1),
      v_visit_date
    )
    ON CONFLICT (report_id, storage_path) WHERE storage_path IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_att_id;

    IF v_att_id IS NOT NULL THEN
      v_attachments_created := v_attachments_created + 1;
    ELSE
      SELECT id INTO v_att_id
      FROM public.site_report_attachments
      WHERE report_id = v_report_id AND storage_path = rec.storage_path;
    END IF;

    INSERT INTO public.visit_capture (
      site_id, organization_id, report_id,
      kind, status, source,
      body, attachment_id,
      created_at, updated_at
    )
    SELECT
      v_site_id, v_org_id, v_report_id,
      'photo', 'processed', 'historical_import',
      rec.caption, v_att_id,
      v_visit_date, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.visit_capture vc
      WHERE vc.attachment_id = v_att_id
    );

    IF FOUND THEN
      v_captures_created := v_captures_created + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_attachments_created, v_captures_created;
END;
$$;

COMMENT ON FUNCTION public.sync_run_photos_to_visit_capture(uuid) IS
  'Backfill idempotent : matérialise en visit_capture les evidence image/page_snapshot '
  'pinned_for_visit=true d''un run DEJA matérialisé (site_reports existant). '
  'Extrait de la boucle photos de materialize_historical_visit() (migration 298/367) '
  'pour contourner son early-return d''idempotence sans le modifier.';
