-- Migration 421 — fn_resync_orphaned_tracked_points(p_site_id)
--
-- Axe B : rattrape automatiquement les tracked_point restés
-- canonical_subject_id IS NULL alors que l'identité canonique de leur(s)
-- thread(s) est désormais résolue (subject_thread_identity.canonical_subject_id
-- non nul). Sans ce correctif, tracked_point.canonical_subject_id n'est écrit
-- qu'à la création du Point (migration 401, CREATE_POINT_WITH_MEMBERSHIP /
-- CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK) — aucune UPDATE ultérieure ne le
-- comble jamais automatiquement, même quand la réconciliation canonique
-- résout tardivement l'identité du sujet.
--
-- Portée stricte :
--   - ne traite que canonical_subject_id IS NULL (jamais de "correction" d'une
--     valeur déjà posée : hors mandat, risque distinct) ;
--   - ignore tout Point protégé par un tracked_point_subject_override actif
--     (curation_kind quelconque, y compris 'detached' = Sans Sujet volontaire) ;
--   - exige que TOUTES les memberships actives scope='thread' du Point
--     résolvent, via subject_thread_identity, vers EXACTEMENT UN sujet
--     canonique non nul ; sinon le Point reste Sans Sujet (0 identité résolue
--     = légitimement en attente, >1 sujet distinct = ambigu) et n'est jamais
--     deviné ;
--   - ne touche jamais subject_thread_identity.source ni
--     tracked_point_member.resolution_source (aucune décision humaine n'a été
--     prise ici, c'est une pure propagation mécanique d'une identité déjà
--     résolue ailleurs) ;
--   - n'écrit jamais dans tracked_point_subject_override (réservé aux
--     véritables décisions de curation humaine, cf. migration 419) ;
--   - cascade tracked_point → canonical_business_object → site_actions /
--     site_deadlines / site_reserve via appartenance CBO, à l'identique de
--     curate_tracked_point_subject (migration 419) ; ne touche pas
--     canonical_subject_occurrence (déjà alignée sur l'identité de thread,
--     indépendante de tracked_point.canonical_subject_id).
--
-- Idempotence : le WHERE canonical_subject_id IS NULL exclut naturellement
-- tout Point déjà rattaché d'un second passage.

CREATE OR REPLACE FUNCTION public.fn_resync_orphaned_tracked_points(
  p_site_id UUID
)
RETURNS TABLE(
  out_tracked_point_id UUID,
  out_label TEXT,
  out_verdict TEXT,
  out_target_canonical_subject_id UUID,
  out_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_point RECORD;
  v_thread_ids UUID[];
  v_thread_count INTEGER;
  v_resolved_subjects UUID[];
  v_target UUID;
  v_cbo_count INTEGER;
  v_action_count INTEGER;
  v_deadline_count INTEGER;
  v_reserve_count INTEGER;
BEGIN
  FOR v_point IN
    SELECT tp.id, tp.label
    FROM public.tracked_point tp
    WHERE tp.site_id = p_site_id
      AND tp.status = 'active'
      AND tp.canonical_subject_id IS NULL
    ORDER BY tp.created_at
    FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.tracked_point_subject_override o
      WHERE o.tracked_point_id = v_point.id
        AND o.superseded_at IS NULL
    ) THEN
      out_tracked_point_id := v_point.id;
      out_label := v_point.label;
      out_verdict := 'skipped_locked';
      out_target_canonical_subject_id := NULL;
      out_reason := 'override actif (curation humaine) — jamais écrasé';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT tpm.subject_thread_id), ARRAY[]::UUID[])
    INTO v_thread_ids
    FROM public.tracked_point_member tpm
    WHERE tpm.tracked_point_id = v_point.id
      AND tpm.status = 'active'
      AND tpm.scope = 'thread';

    v_thread_count := COALESCE(array_length(v_thread_ids, 1), 0);

    IF v_thread_count = 0 THEN
      out_tracked_point_id := v_point.id;
      out_label := v_point.label;
      out_verdict := 'skipped_no_thread';
      out_target_canonical_subject_id := NULL;
      out_reason := 'aucune membership thread active';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT sti.canonical_subject_id), ARRAY[]::UUID[])
    INTO v_resolved_subjects
    FROM public.subject_thread_identity sti
    WHERE sti.subject_thread_id = ANY(v_thread_ids)
      AND sti.site_id = p_site_id
      AND sti.canonical_subject_id IS NOT NULL;

    IF COALESCE(array_length(v_resolved_subjects, 1), 0) = 0 THEN
      out_tracked_point_id := v_point.id;
      out_label := v_point.label;
      out_verdict := 'skipped_unresolved';
      out_target_canonical_subject_id := NULL;
      out_reason := 'thread(s) sans identité canonique résolue';
      RETURN NEXT;
      CONTINUE;
    ELSIF array_length(v_resolved_subjects, 1) > 1 THEN
      out_tracked_point_id := v_point.id;
      out_label := v_point.label;
      out_verdict := 'skipped_ambiguous';
      out_target_canonical_subject_id := NULL;
      out_reason := format('threads résolus vers %s sujets distincts', array_length(v_resolved_subjects, 1));
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_target := v_resolved_subjects[1];

    IF NOT EXISTS (
      SELECT 1 FROM public.canonical_subject cs
      WHERE cs.id = v_target
        AND cs.site_id = p_site_id
        AND cs.status = 'active'
        AND cs.kind = 'business_subject'
        AND cs.company_id IS NULL
        AND cs.contact_id IS NULL
    ) THEN
      out_tracked_point_id := v_point.id;
      out_label := v_point.label;
      out_verdict := 'skipped_target_invalid';
      out_target_canonical_subject_id := v_target;
      out_reason := 'sujet cible introuvable ou inactif';
      RETURN NEXT;
      CONTINUE;
    END IF;

    UPDATE public.tracked_point
    SET canonical_subject_id = v_target,
        updated_at = now()
    WHERE id = v_point.id
      AND site_id = p_site_id;

    UPDATE public.canonical_business_object
    SET canonical_subject_id = v_target,
        updated_at = now()
    WHERE tracked_point_id = v_point.id
      AND site_id = p_site_id;
    GET DIAGNOSTICS v_cbo_count = ROW_COUNT;

    WITH point_cbos AS (
      SELECT id
      FROM public.canonical_business_object
      WHERE tracked_point_id = v_point.id
        AND site_id = p_site_id
    ),
    moved_actions AS (
      UPDATE public.site_actions sa
      SET canonical_subject_id = v_target
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
      WHERE tracked_point_id = v_point.id
        AND site_id = p_site_id
    )
    UPDATE public.site_deadlines sd
    SET canonical_subject_id = v_target
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
      WHERE tracked_point_id = v_point.id
        AND site_id = p_site_id
    )
    UPDATE public.site_reserve sr
    SET canonical_subject_id = v_target
    WHERE sr.site_id = p_site_id
      AND EXISTS (
        SELECT 1
        FROM public.canonical_business_object_member cbom
        JOIN point_cbos pc ON pc.id = cbom.canonical_business_object_id
        WHERE cbom.member_entity_type = 'site_reserve'
          AND cbom.member_entity_id = sr.id
      );
    GET DIAGNOSTICS v_reserve_count = ROW_COUNT;

    out_tracked_point_id := v_point.id;
    out_label := v_point.label;
    out_verdict := 'resynced';
    out_target_canonical_subject_id := v_target;
    out_reason := format(
      'cbo=%s action=%s deadline=%s reserve=%s',
      v_cbo_count, v_action_count, v_deadline_count, v_reserve_count
    );
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_resync_orphaned_tracked_points(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_resync_orphaned_tracked_points(UUID) TO service_role;

COMMENT ON FUNCTION public.fn_resync_orphaned_tracked_points(UUID) IS
  'Axe B : rattache automatiquement les tracked_point.canonical_subject_id '
  'IS NULL dont les threads sont désormais résolus vers un sujet canonique '
  'unique. Ne touche jamais un Point sous override humain actif, jamais une '
  'identité ambiguë, jamais un Point déjà rattaché (idempotent par '
  'construction). Cascade CBO/actions/échéances/réserves identique à '
  'curate_tracked_point_subject (migration 419), sans jamais écrire '
  'tracked_point_subject_override ni marquer source=''manual''.';
