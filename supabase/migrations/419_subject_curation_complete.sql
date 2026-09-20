-- P1 subject curation: create subject from a Point, manual detachment, rename and merge.
-- Keeps the existing durable Point -> Subject curation path and extends it instead of
-- introducing ad-hoc FK updates.

ALTER TABLE public.tracked_point_subject_override
  ALTER COLUMN target_canonical_subject_id DROP NOT NULL;

ALTER TABLE public.tracked_point_subject_override
  ADD COLUMN IF NOT EXISTS curation_kind TEXT NOT NULL DEFAULT 'target_subject'
  CHECK (curation_kind IN ('target_subject', 'detached', 'created_subject'));

CREATE TABLE IF NOT EXISTS public.canonical_subject_curation_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  canonical_subject_id UUID REFERENCES public.canonical_subject(id) ON DELETE SET NULL,
  target_canonical_subject_id UUID REFERENCES public.canonical_subject(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created_from_point', 'renamed', 'merged')),
  previous_label TEXT,
  new_label TEXT,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canonical_subject_curation_event_site_idx
  ON public.canonical_subject_curation_event(site_id);

CREATE INDEX IF NOT EXISTS canonical_subject_curation_event_subject_idx
  ON public.canonical_subject_curation_event(canonical_subject_id);

ALTER TABLE public.canonical_subject_curation_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can view canonical_subject_curation_event"
  ON public.canonical_subject_curation_event;
CREATE POLICY "org members can view canonical_subject_curation_event"
  ON public.canonical_subject_curation_event FOR SELECT
  USING (
    site_id IN (
      SELECT s.id
      FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS "service role manages canonical_subject_curation_event"
  ON public.canonical_subject_curation_event;
CREATE POLICY "service role manages canonical_subject_curation_event"
  ON public.canonical_subject_curation_event FOR ALL
  USING (auth.role() = 'service_role');

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
  v_kind TEXT;
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

  IF p_target_canonical_subject_id IS NOT NULL THEN
    SELECT * INTO v_target
    FROM public.canonical_subject
    WHERE id = p_target_canonical_subject_id
      AND site_id = p_site_id
      AND status = 'active'
      AND kind = 'business_subject'
      AND company_id IS NULL
      AND contact_id IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'target_subject_not_found');
    END IF;
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
  v_kind := CASE WHEN p_target_canonical_subject_id IS NULL THEN 'detached' ELSE 'target_subject' END;

  IF v_previous_subject_id IS NOT DISTINCT FROM p_target_canonical_subject_id
     AND EXISTS (
       SELECT 1 FROM public.tracked_point_subject_override o
       WHERE o.tracked_point_id = p_tracked_point_id
         AND o.superseded_at IS NULL
         AND o.target_canonical_subject_id IS NOT DISTINCT FROM p_target_canonical_subject_id
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.subject_thread_identity sti
       WHERE p_target_canonical_subject_id IS NOT NULL
         AND sti.subject_thread_id = ANY(v_thread_ids)
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

  IF p_target_canonical_subject_id IS NOT NULL THEN
    UPDATE public.subject_thread_identity
    SET canonical_subject_id = p_target_canonical_subject_id,
        source = 'manual',
        reviewed_at = now(),
        reviewed_by = p_user_id
    WHERE subject_thread_id = ANY(v_thread_ids)
      AND site_id = p_site_id;
    GET DIAGNOSTICS v_sti_count = ROW_COUNT;
  END IF;

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

  IF p_target_canonical_subject_id IS NOT NULL THEN
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
  END IF;

  INSERT INTO public.tracked_point_subject_override (
    site_id,
    tracked_point_id,
    previous_canonical_subject_id,
    target_canonical_subject_id,
    subject_thread_ids,
    reason,
    affected_counts,
    created_by,
    curation_kind
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
    p_user_id,
    v_kind
  )
  RETURNING id INTO v_override_id;

  RETURN jsonb_build_object(
    'ok', true,
    'code', CASE WHEN p_target_canonical_subject_id IS NULL THEN 'detached' ELSE 'moved' END,
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

CREATE OR REPLACE FUNCTION public.create_subject_from_tracked_point(
  p_site_id UUID,
  p_tracked_point_id UUID,
  p_label TEXT,
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
  v_existing public.canonical_subject%ROWTYPE;
  v_subject_id UUID;
  v_curated JSONB;
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

  IF length(trim(coalesce(p_label, ''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'label_required');
  END IF;

  SELECT * INTO v_existing
  FROM public.canonical_subject
  WHERE site_id = p_site_id
    AND status = 'active'
    AND kind = 'business_subject'
    AND company_id IS NULL
    AND contact_id IS NULL
    AND lower(trim(label)) = lower(trim(p_label))
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'duplicate_subject',
      'existingCanonicalSubjectId', v_existing.id,
      'existingLabel', v_existing.label
    );
  END IF;

  INSERT INTO public.canonical_subject (site_id, label, aliases, status, creation_source, kind, source)
  VALUES (p_site_id, trim(p_label), ARRAY[]::TEXT[], 'active', 'manual', 'business_subject', 'manual')
  RETURNING id INTO v_subject_id;

  INSERT INTO public.canonical_subject_curation_event (
    site_id, canonical_subject_id, event_type, new_label, reason, payload, created_by
  )
  VALUES (
    p_site_id, v_subject_id, 'created_from_point', trim(p_label), p_reason,
    jsonb_build_object('trackedPointId', p_tracked_point_id),
    p_user_id
  );

  v_curated := public.curate_tracked_point_subject(
    p_site_id, p_tracked_point_id, v_subject_id, p_user_id, p_reason
  );

  UPDATE public.tracked_point_subject_override
  SET curation_kind = 'created_subject'
  WHERE tracked_point_id = p_tracked_point_id
    AND superseded_at IS NULL;

  RETURN v_curated || jsonb_build_object(
    'createdCanonicalSubjectId', v_subject_id,
    'code', CASE WHEN (v_curated->>'ok')::boolean THEN 'created_subject' ELSE v_curated->>'code' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_subject_from_tracked_point(UUID, UUID, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_subject_from_tracked_point(UUID, UUID, TEXT, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.rename_canonical_subject_manual(
  p_site_id UUID,
  p_canonical_subject_id UUID,
  p_new_label TEXT,
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject public.canonical_subject%ROWTYPE;
  v_new_label TEXT;
  v_aliases TEXT[];
BEGIN
  v_new_label := trim(coalesce(p_new_label, ''));
  IF length(v_new_label) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'label_required');
  END IF;

  SELECT * INTO v_subject
  FROM public.canonical_subject
  WHERE id = p_canonical_subject_id
    AND site_id = p_site_id
    AND status = 'active'
    AND kind = 'business_subject'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'subject_not_found');
  END IF;

  IF v_subject.label = v_new_label THEN
    RETURN jsonb_build_object('ok', true, 'code', 'no_op', 'canonicalSubjectId', p_canonical_subject_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.canonical_subject
    WHERE site_id = p_site_id
      AND id <> p_canonical_subject_id
      AND status = 'active'
      AND kind = 'business_subject'
      AND lower(trim(label)) = lower(v_new_label)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'duplicate_subject');
  END IF;

  v_aliases := ARRAY(
    SELECT DISTINCT x
    FROM unnest(coalesce(v_subject.aliases, ARRAY[]::TEXT[]) || ARRAY[v_subject.label]) AS x
    WHERE x IS NOT NULL AND x <> v_new_label
  );

  UPDATE public.canonical_subject
  SET label = v_new_label,
      aliases = v_aliases,
      source = 'manual'
  WHERE id = p_canonical_subject_id;

  INSERT INTO public.canonical_subject_curation_event (
    site_id, canonical_subject_id, event_type, previous_label, new_label, reason, created_by
  )
  VALUES (
    p_site_id, p_canonical_subject_id, 'renamed', v_subject.label, v_new_label, p_reason, p_user_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'renamed',
    'canonicalSubjectId', p_canonical_subject_id,
    'previousLabel', v_subject.label,
    'newLabel', v_new_label
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rename_canonical_subject_manual(UUID, UUID, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_canonical_subject_manual(UUID, UUID, TEXT, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.merge_canonical_subjects_manual(
  p_site_id UUID,
  p_source_canonical_subject_id UUID,
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
  v_source public.canonical_subject%ROWTYPE;
  v_target public.canonical_subject%ROWTYPE;
  v_merge JSONB;
  v_tp_count INTEGER := 0;
  v_action_count INTEGER := 0;
  v_deadline_count INTEGER := 0;
  v_reserve_count INTEGER := 0;
BEGIN
  IF p_source_canonical_subject_id = p_target_canonical_subject_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'same_subject');
  END IF;

  SELECT * INTO v_source
  FROM public.canonical_subject
  WHERE id = p_source_canonical_subject_id
    AND site_id = p_site_id
    AND kind = 'business_subject'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'source_subject_not_found');
  END IF;
  IF v_source.status = 'merged' AND v_source.merged_into = p_target_canonical_subject_id THEN
    RETURN jsonb_build_object(
      'ok', true,
      'code', 'no_op',
      'sourceCanonicalSubjectId', p_source_canonical_subject_id,
      'targetCanonicalSubjectId', p_target_canonical_subject_id
    );
  END IF;
  IF v_source.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'source_subject_not_active');
  END IF;

  SELECT * INTO v_target
  FROM public.canonical_subject
  WHERE id = p_target_canonical_subject_id
    AND site_id = p_site_id
    AND status = 'active'
    AND kind = 'business_subject'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'target_subject_not_found');
  END IF;

  v_merge := public.merge_canonical_subjects(p_source_canonical_subject_id, p_target_canonical_subject_id);

  UPDATE public.tracked_point
  SET canonical_subject_id = p_target_canonical_subject_id,
      updated_at = now()
  WHERE site_id = p_site_id
    AND canonical_subject_id = p_source_canonical_subject_id
    AND status = 'active';
  GET DIAGNOSTICS v_tp_count = ROW_COUNT;

  UPDATE public.site_actions
  SET canonical_subject_id = p_target_canonical_subject_id
  WHERE site_id = p_site_id
    AND canonical_subject_id = p_source_canonical_subject_id;
  GET DIAGNOSTICS v_action_count = ROW_COUNT;

  UPDATE public.site_deadlines
  SET canonical_subject_id = p_target_canonical_subject_id
  WHERE site_id = p_site_id
    AND canonical_subject_id = p_source_canonical_subject_id;
  GET DIAGNOSTICS v_deadline_count = ROW_COUNT;

  UPDATE public.site_reserve
  SET canonical_subject_id = p_target_canonical_subject_id
  WHERE site_id = p_site_id
    AND canonical_subject_id = p_source_canonical_subject_id;
  GET DIAGNOSTICS v_reserve_count = ROW_COUNT;

  INSERT INTO public.canonical_subject_merge (
    winner_subject_id,
    loser_subject_id,
    suggested_label,
    resolution_source,
    engine_version,
    snapshot
  )
  VALUES (
    p_target_canonical_subject_id,
    p_source_canonical_subject_id,
    NULL,
    'manual',
    'p1-subject-curation-419',
    jsonb_build_object(
      'reason', p_reason,
      'sourceLabel', v_source.label,
      'targetLabel', v_target.label,
      'trackedPointsMoved', v_tp_count,
      'siteActionsMoved', v_action_count,
      'siteDeadlinesMoved', v_deadline_count,
      'siteReservesMoved', v_reserve_count,
      'mergeResult', v_merge
    )
  )
  ON CONFLICT (loser_subject_id) DO NOTHING;

  INSERT INTO public.canonical_subject_curation_event (
    site_id, canonical_subject_id, target_canonical_subject_id, event_type,
    previous_label, new_label, reason, payload, created_by
  )
  VALUES (
    p_site_id, p_source_canonical_subject_id, p_target_canonical_subject_id, 'merged',
    v_source.label, v_target.label, p_reason,
    jsonb_build_object(
      'trackedPointsMoved', v_tp_count,
      'siteActionsMoved', v_action_count,
      'siteDeadlinesMoved', v_deadline_count,
      'siteReservesMoved', v_reserve_count,
      'mergeResult', v_merge
    ),
    p_user_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'merged',
    'sourceCanonicalSubjectId', p_source_canonical_subject_id,
    'targetCanonicalSubjectId', p_target_canonical_subject_id,
    'trackedPointsMoved', v_tp_count,
    'siteActionsMoved', v_action_count,
    'siteDeadlinesMoved', v_deadline_count,
    'siteReservesMoved', v_reserve_count,
    'mergeResult', v_merge
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'code', 'no_op', 'sourceCanonicalSubjectId', p_source_canonical_subject_id, 'targetCanonicalSubjectId', p_target_canonical_subject_id);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_canonical_subjects_manual(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_canonical_subjects_manual(UUID, UUID, UUID, UUID, TEXT) TO service_role;
