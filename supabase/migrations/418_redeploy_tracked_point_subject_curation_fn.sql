-- Migration 418 — redéploiement de curate_tracked_point_subject.
--
-- Corrige la version 417 : site_actions n'a pas de colonne updated_at.

CREATE OR REPLACE FUNCTION public.curate_tracked_point_subject(
  p_site_id UUID,
  p_tracked_point_id UUID,
  p_target_canonical_subject_id UUID,
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_point public.tracked_point%ROWTYPE;
  v_target public.canonical_subject%ROWTYPE;
  v_thread_ids UUID[];
  v_previous_subject_id UUID;
  v_sti_count INTEGER := 0;
  v_point_count INTEGER := 0;
  v_member_count INTEGER := 0;
  v_cbo_count INTEGER := 0;
  v_action_count INTEGER := 0;
  v_deadline_count INTEGER := 0;
  v_reserve_count INTEGER := 0;
  v_occ_duplicate_count INTEGER := 0;
  v_occ_count INTEGER := 0;
  v_override_id UUID;
  v_identity_count INTEGER := 0;
BEGIN
  SELECT * INTO v_point
  FROM public.tracked_point
  WHERE id = p_tracked_point_id
    AND site_id = p_site_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'point_not_found');
  END IF;

  SELECT * INTO v_target
  FROM public.canonical_subject
  WHERE id = p_target_canonical_subject_id
    AND site_id = p_site_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'target_subject_not_found');
  END IF;

  SELECT COALESCE(array_agg(subject_thread_id ORDER BY subject_thread_id), ARRAY[]::UUID[])
  INTO v_thread_ids
  FROM public.tracked_point_member
  WHERE tracked_point_id = p_tracked_point_id
    AND status = 'active'
    AND scope = 'thread';

  IF array_length(v_thread_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'no_active_thread_membership');
  END IF;

  SELECT count(*) INTO v_identity_count
  FROM public.subject_thread_identity
  WHERE subject_thread_id = ANY(v_thread_ids)
    AND site_id = p_site_id;

  IF v_identity_count <> array_length(v_thread_ids, 1) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_thread_identity');
  END IF;

  v_previous_subject_id := v_point.canonical_subject_id;

  IF v_previous_subject_id = p_target_canonical_subject_id AND NOT EXISTS (
    SELECT 1
    FROM public.subject_thread_identity sti
    WHERE sti.subject_thread_id = ANY(v_thread_ids)
      AND sti.site_id = p_site_id
      AND sti.canonical_subject_id IS DISTINCT FROM p_target_canonical_subject_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'code', 'no_op',
      'trackedPointId', p_tracked_point_id,
      'targetCanonicalSubjectId', p_target_canonical_subject_id,
      'threadIds', to_jsonb(v_thread_ids)
    );
  END IF;

  UPDATE public.tracked_point_subject_override
  SET superseded_at = now()
  WHERE tracked_point_id = p_tracked_point_id
    AND superseded_at IS NULL;

  UPDATE public.subject_thread_identity
  SET canonical_subject_id = p_target_canonical_subject_id,
      source = 'manual',
      reviewed_at = now(),
      reviewed_by = p_user_id
  WHERE subject_thread_id = ANY(v_thread_ids)
    AND site_id = p_site_id;
  GET DIAGNOSTICS v_sti_count = ROW_COUNT;

  UPDATE public.tracked_point
  SET canonical_subject_id = p_target_canonical_subject_id,
      updated_at = now()
  WHERE id = p_tracked_point_id
    AND site_id = p_site_id;
  GET DIAGNOSTICS v_point_count = ROW_COUNT;

  UPDATE public.tracked_point_member
  SET resolution_source = 'manual',
      subject_mismatch = false
  WHERE tracked_point_id = p_tracked_point_id
    AND status = 'active'
    AND scope = 'thread';
  GET DIAGNOSTICS v_member_count = ROW_COUNT;

  UPDATE public.canonical_business_object
  SET canonical_subject_id = p_target_canonical_subject_id,
      updated_at = now()
  WHERE tracked_point_id = p_tracked_point_id
    AND site_id = p_site_id;
  GET DIAGNOSTICS v_cbo_count = ROW_COUNT;

  WITH point_cbos AS (
    SELECT id
    FROM public.canonical_business_object
    WHERE tracked_point_id = p_tracked_point_id
      AND site_id = p_site_id
  ),
  moved_actions AS (
    UPDATE public.site_actions sa
    SET canonical_subject_id = p_target_canonical_subject_id
    WHERE sa.site_id = p_site_id
      AND EXISTS (
        SELECT 1
        FROM public.canonical_business_object_member cbom
        JOIN point_cbos pc ON pc.id = cbom.canonical_business_object_id
        WHERE cbom.member_entity_type = 'site_action'
          AND cbom.member_entity_id = sa.id
      )
    RETURNING sa.id
  )
  SELECT count(*) INTO v_action_count FROM moved_actions;

  WITH point_cbos AS (
    SELECT id
    FROM public.canonical_business_object
    WHERE tracked_point_id = p_tracked_point_id
      AND site_id = p_site_id
  )
  UPDATE public.site_deadlines sd
  SET canonical_subject_id = p_target_canonical_subject_id
  WHERE sd.site_id = p_site_id
    AND EXISTS (
      SELECT 1
      FROM public.canonical_business_object_member cbom
      JOIN point_cbos pc ON pc.id = cbom.canonical_business_object_id
      WHERE cbom.member_entity_type = 'site_deadline'
        AND cbom.member_entity_id = sd.id
    );
  GET DIAGNOSTICS v_deadline_count = ROW_COUNT;

  WITH point_cbos AS (
    SELECT id
    FROM public.canonical_business_object
    WHERE tracked_point_id = p_tracked_point_id
      AND site_id = p_site_id
  )
  UPDATE public.site_reserve sr
  SET canonical_subject_id = p_target_canonical_subject_id
  WHERE sr.site_id = p_site_id
    AND EXISTS (
      SELECT 1
      FROM public.canonical_business_object_member cbom
      JOIN point_cbos pc ON pc.id = cbom.canonical_business_object_id
      WHERE cbom.member_entity_type = 'site_reserve'
        AND cbom.member_entity_id = sr.id
    );
  GET DIAGNOSTICS v_reserve_count = ROW_COUNT;

  WITH thread_props AS (
    SELECT dep.label, sr.id AS site_report_id
    FROM public.document_extraction_proposal dep
    JOIN public.site_reports sr
      ON sr.source_document_id = dep.document_id
     AND sr.site_id = p_site_id
    JOIN public.documents d
      ON d.id = dep.document_id
     AND d.deleted_at IS NULL
    WHERE dep.subject_thread_id = ANY(v_thread_ids)
      AND dep.label IS NOT NULL
  ),
  duplicate_occurrences AS (
    DELETE FROM public.canonical_subject_occurrence old_occ
    USING public.canonical_subject_occurrence target_occ, thread_props tp
    WHERE old_occ.site_id = p_site_id
      AND old_occ.canonical_subject_id = v_previous_subject_id
      AND old_occ.source_kind = 'historical_pdf'
      AND old_occ.source_ref_id = tp.site_report_id
      AND lower(old_occ.label) = lower(tp.label)
      AND target_occ.site_id = p_site_id
      AND target_occ.canonical_subject_id = p_target_canonical_subject_id
      AND target_occ.source_kind = old_occ.source_kind
      AND target_occ.source_ref_id = old_occ.source_ref_id
      AND target_occ.state_key IS NOT DISTINCT FROM old_occ.state_key
      AND target_occ.id <> old_occ.id
    RETURNING old_occ.id
  )
  SELECT count(*) INTO v_occ_duplicate_count FROM duplicate_occurrences;

  WITH thread_props AS (
    SELECT dep.label, sr.id AS site_report_id
    FROM public.document_extraction_proposal dep
    JOIN public.site_reports sr
      ON sr.source_document_id = dep.document_id
     AND sr.site_id = p_site_id
    JOIN public.documents d
      ON d.id = dep.document_id
     AND d.deleted_at IS NULL
    WHERE dep.subject_thread_id = ANY(v_thread_ids)
      AND dep.label IS NOT NULL
  ),
  moved_occurrences AS (
    UPDATE public.canonical_subject_occurrence occ
    SET canonical_subject_id = p_target_canonical_subject_id
    FROM thread_props tp
    WHERE occ.site_id = p_site_id
      AND occ.canonical_subject_id = v_previous_subject_id
      AND occ.source_kind = 'historical_pdf'
      AND occ.source_ref_id = tp.site_report_id
      AND lower(occ.label) = lower(tp.label)
    RETURNING occ.id
  )
  SELECT count(*) INTO v_occ_count FROM moved_occurrences;

  INSERT INTO public.tracked_point_subject_override (
    site_id,
    tracked_point_id,
    previous_canonical_subject_id,
    target_canonical_subject_id,
    subject_thread_ids,
    reason,
    affected_counts,
    created_by
  )
  VALUES (
    p_site_id,
    p_tracked_point_id,
    v_previous_subject_id,
    p_target_canonical_subject_id,
    v_thread_ids,
    p_reason,
    jsonb_build_object(
      'subjectThreadIdentity', v_sti_count,
      'trackedPoint', v_point_count,
      'trackedPointMember', v_member_count,
      'canonicalBusinessObject', v_cbo_count,
      'siteAction', v_action_count,
      'siteDeadline', v_deadline_count,
      'siteReserve', v_reserve_count,
      'canonicalSubjectOccurrenceMoved', v_occ_count,
      'canonicalSubjectOccurrenceDeduped', v_occ_duplicate_count
    ),
    p_user_id
  )
  RETURNING id INTO v_override_id;

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'moved',
    'overrideId', v_override_id,
    'trackedPointId', p_tracked_point_id,
    'previousCanonicalSubjectId', v_previous_subject_id,
    'targetCanonicalSubjectId', p_target_canonical_subject_id,
    'threadIds', to_jsonb(v_thread_ids),
    'affectedCounts', jsonb_build_object(
      'subjectThreadIdentity', v_sti_count,
      'trackedPoint', v_point_count,
      'trackedPointMember', v_member_count,
      'canonicalBusinessObject', v_cbo_count,
      'siteAction', v_action_count,
      'siteDeadline', v_deadline_count,
      'siteReserve', v_reserve_count,
      'canonicalSubjectOccurrenceMoved', v_occ_count,
      'canonicalSubjectOccurrenceDeduped', v_occ_duplicate_count
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.curate_tracked_point_subject(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.curate_tracked_point_subject(UUID, UUID, UUID, UUID, TEXT) TO service_role;
