-- Migration 422 — curate_subject_thread_identity(site, thread, target, user, reason)
--
-- Axe B2 : déplace UN thread isolé (subject_thread_identity) vers un autre
-- canonical_subject, avec provenance humaine durable, pour le cas où ce thread
-- n'a jamais eu de tracked_point (donc hors périmètre de
-- curate_tracked_point_subject, migration 419, qui opère sur tracked_point).
--
-- Contexte (audit Axe B2, témoin BAPI) : un thread historique isolé peut être
-- mal rattaché à un canonical_subject dès le seed automatique (Lot 1,
-- source='auto') sans qu'aucun Point n'ait jamais existé dessus. Fusionner les
-- deux Subjects (merge_canonical_subjects_manual, migration 419) serait hors
-- de proportion : ça déplacerait TOUS les threads du Subject source, y compris
-- des rattachements par ailleurs corrects. Le geste correct est de déplacer ce
-- seul thread, jamais le Subject qui le contient.
--
-- Garanties :
--   - même site obligatoire (thread et Subject cible doivent appartenir à
--     p_site_id ; sinon thread_not_found / target_subject_not_found — jamais
--     de fusion inter-site) ;
--   - marque durablement la décision humaine (source='manual', reviewed_at,
--     reviewed_by) directement sur la ligne subject_thread_identity ;
--   - n'écrit rien d'autre que cette ligne, ses occurrences documentaires
--     dépendantes et, si un Point existe déjà pour ce thread, sa cascade
--     Point/CBO — ne touche JAMAIS un autre thread du Subject source ;
--   - future-proof face à la réconciliation automatique : tous les points
--     d'écriture auto de subject_thread_identity dans le code (P1 seed,
--     historical reconcile, actor-auto-link, etc.) utilisent
--     upsert(..., { onConflict: 'subject_thread_id', ignoreDuplicates: true })
--     sur la clé primaire subject_thread_id — une ligne existante n'est donc
--     JAMAIS réécrite par un passage automatique ultérieur, quelle que soit sa
--     source. Cette fonction ne fait qu'ajouter une preuve de curation
--     humaine sur une garantie déjà structurelle ;
--   - cascade Point/CBO/actions/échéances/réserves identique à
--     curate_tracked_point_subject, mais seulement si un Point actif existe
--     déjà pour ce thread ET que TOUTES ses memberships actives résolvent
--     déjà, sans ambiguïté, vers la même cible — jamais de devinette, jamais
--     d'écrasement d'un override actif (tracked_point_subject_override) ;
--   - ne touche jamais canonical_subject_occurrence en dehors des occurrences
--     documentaires réellement rattachées à ce thread (même jointure que
--     curate_tracked_point_subject via document_extraction_proposal /
--     site_reports) ;
--   - trace la décision dans canonical_subject_curation_event
--     (event_type='thread_retargeted', réutilise la table de la migration
--     311/419 plutôt que d'en créer une nouvelle) ;
--   - idempotent : un second appel vers la même cible est un no-op explicite.

ALTER TABLE public.canonical_subject_curation_event
  DROP CONSTRAINT IF EXISTS canonical_subject_curation_event_event_type_check;

ALTER TABLE public.canonical_subject_curation_event
  ADD CONSTRAINT canonical_subject_curation_event_event_type_check
  CHECK (event_type IN ('created_from_point', 'renamed', 'merged', 'thread_retargeted'));

CREATE OR REPLACE FUNCTION public.curate_subject_thread_identity(
  p_site_id UUID,
  p_subject_thread_id UUID,
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
  v_sti public.subject_thread_identity%ROWTYPE;
  v_target public.canonical_subject%ROWTYPE;
  v_previous_subject_id UUID;
  v_point_id UUID;
  v_point_resolved_subjects UUID[];
  v_point_count INTEGER := 0;
  v_cbo_count INTEGER := 0;
  v_action_count INTEGER := 0;
  v_deadline_count INTEGER := 0;
  v_reserve_count INTEGER := 0;
  v_occ_count INTEGER := 0;
  v_occ_duplicate_count INTEGER := 0;
BEGIN
  SELECT * INTO v_sti
  FROM public.subject_thread_identity
  WHERE subject_thread_id = p_subject_thread_id
    AND site_id = p_site_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'thread_not_found');
  END IF;

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

  v_previous_subject_id := v_sti.canonical_subject_id;

  IF v_previous_subject_id = p_target_canonical_subject_id THEN
    RETURN jsonb_build_object(
      'ok', true,
      'code', 'no_op',
      'subjectThreadId', p_subject_thread_id,
      'canonicalSubjectId', p_target_canonical_subject_id
    );
  END IF;

  UPDATE public.subject_thread_identity
  SET canonical_subject_id = p_target_canonical_subject_id,
      source = 'manual',
      reviewed_at = now(),
      reviewed_by = p_user_id
  WHERE subject_thread_id = p_subject_thread_id
    AND site_id = p_site_id;

  WITH thread_props AS (
    SELECT dep.label, sr.id AS site_report_id
    FROM public.document_extraction_proposal dep
    JOIN public.site_reports sr
      ON sr.source_document_id = dep.document_id
     AND sr.site_id = p_site_id
    JOIN public.documents d
      ON d.id = dep.document_id
     AND d.deleted_at IS NULL
    WHERE dep.subject_thread_id = p_subject_thread_id
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
    WHERE dep.subject_thread_id = p_subject_thread_id
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

  SELECT tpm.tracked_point_id INTO v_point_id
  FROM public.tracked_point_member tpm
  JOIN public.tracked_point tp ON tp.id = tpm.tracked_point_id
  WHERE tpm.subject_thread_id = p_subject_thread_id
    AND tpm.status = 'active'
    AND tpm.scope = 'thread'
    AND tp.site_id = p_site_id
    AND tp.status = 'active'
  LIMIT 1;

  IF v_point_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.tracked_point_subject_override o
       WHERE o.tracked_point_id = v_point_id
         AND o.superseded_at IS NULL
     )
  THEN
    SELECT COALESCE(array_agg(DISTINCT sti.canonical_subject_id), ARRAY[]::UUID[])
    INTO v_point_resolved_subjects
    FROM public.tracked_point_member tpm2
    JOIN public.subject_thread_identity sti ON sti.subject_thread_id = tpm2.subject_thread_id
    WHERE tpm2.tracked_point_id = v_point_id
      AND tpm2.status = 'active'
      AND tpm2.scope = 'thread'
      AND sti.site_id = p_site_id
      AND sti.canonical_subject_id IS NOT NULL;

    IF array_length(v_point_resolved_subjects, 1) = 1
       AND v_point_resolved_subjects[1] = p_target_canonical_subject_id
    THEN
      UPDATE public.tracked_point
      SET canonical_subject_id = p_target_canonical_subject_id,
          updated_at = now()
      WHERE id = v_point_id
        AND site_id = p_site_id;
      GET DIAGNOSTICS v_point_count = ROW_COUNT;

      UPDATE public.canonical_business_object
      SET canonical_subject_id = p_target_canonical_subject_id,
          updated_at = now()
      WHERE tracked_point_id = v_point_id
        AND site_id = p_site_id;
      GET DIAGNOSTICS v_cbo_count = ROW_COUNT;

      WITH point_cbos AS (
        SELECT id FROM public.canonical_business_object
        WHERE tracked_point_id = v_point_id AND site_id = p_site_id
      ),
      moved_actions AS (
        UPDATE public.site_actions sa
        SET canonical_subject_id = p_target_canonical_subject_id
        WHERE sa.site_id = p_site_id
          AND EXISTS (
            SELECT 1 FROM public.canonical_business_object_member cbom
            JOIN point_cbos pc ON pc.id = cbom.canonical_business_object_id
            WHERE cbom.member_entity_type = 'site_action'
              AND cbom.member_entity_id = sa.id
          )
        RETURNING sa.id
      )
      SELECT count(*) INTO v_action_count FROM moved_actions;

      WITH point_cbos AS (
        SELECT id FROM public.canonical_business_object
        WHERE tracked_point_id = v_point_id AND site_id = p_site_id
      )
      UPDATE public.site_deadlines sd
      SET canonical_subject_id = p_target_canonical_subject_id
      WHERE sd.site_id = p_site_id
        AND EXISTS (
          SELECT 1 FROM public.canonical_business_object_member cbom
          JOIN point_cbos pc ON pc.id = cbom.canonical_business_object_id
          WHERE cbom.member_entity_type = 'site_deadline'
            AND cbom.member_entity_id = sd.id
        );
      GET DIAGNOSTICS v_deadline_count = ROW_COUNT;

      WITH point_cbos AS (
        SELECT id FROM public.canonical_business_object
        WHERE tracked_point_id = v_point_id AND site_id = p_site_id
      )
      UPDATE public.site_reserve sr
      SET canonical_subject_id = p_target_canonical_subject_id
      WHERE sr.site_id = p_site_id
        AND EXISTS (
          SELECT 1 FROM public.canonical_business_object_member cbom
          JOIN point_cbos pc ON pc.id = cbom.canonical_business_object_id
          WHERE cbom.member_entity_type = 'site_reserve'
            AND cbom.member_entity_id = sr.id
        );
      GET DIAGNOSTICS v_reserve_count = ROW_COUNT;
    END IF;
  END IF;

  INSERT INTO public.canonical_subject_curation_event (
    site_id, canonical_subject_id, target_canonical_subject_id, event_type,
    previous_label, new_label, reason, payload, created_by
  )
  VALUES (
    p_site_id, v_previous_subject_id, p_target_canonical_subject_id, 'thread_retargeted',
    NULL, NULL, p_reason,
    jsonb_build_object(
      'subjectThreadId', p_subject_thread_id,
      'previousCanonicalSubjectId', v_previous_subject_id,
      'targetCanonicalSubjectId', p_target_canonical_subject_id,
      'trackedPointId', v_point_id,
      'trackedPointMoved', v_point_count,
      'canonicalBusinessObjectMoved', v_cbo_count,
      'siteActionMoved', v_action_count,
      'siteDeadlineMoved', v_deadline_count,
      'siteReserveMoved', v_reserve_count,
      'canonicalSubjectOccurrenceMoved', v_occ_count,
      'canonicalSubjectOccurrenceDeduped', v_occ_duplicate_count
    ),
    p_user_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'retargeted',
    'subjectThreadId', p_subject_thread_id,
    'previousCanonicalSubjectId', v_previous_subject_id,
    'targetCanonicalSubjectId', p_target_canonical_subject_id,
    'trackedPointId', v_point_id,
    'affectedCounts', jsonb_build_object(
      'trackedPoint', v_point_count,
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

REVOKE ALL ON FUNCTION public.curate_subject_thread_identity(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.curate_subject_thread_identity(UUID, UUID, UUID, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.curate_subject_thread_identity(UUID, UUID, UUID, UUID, TEXT) IS
  'Axe B2 : déplace un unique subject_thread_identity vers un autre '
  'canonical_subject, avec provenance humaine durable (source=''manual'', '
  'reviewed_at/reviewed_by + canonical_subject_curation_event). Ne touche '
  'jamais un autre thread du Subject source (jamais l''équivalent d''un merge '
  'de Subject). Cascade Point/CBO/actions/échéances/réserves uniquement si un '
  'Point actif existe déjà pour ce thread et résout sans ambiguïté vers la '
  'même cible ; jamais d''override humain écrasé. Idempotent : un second '
  'appel vers la même cible est un no-op.';
