-- Migration 393 : accept_trace_identity_candidate (Phase 6E.2B)
--
-- GO explicite de Vincent après PASS de 6E.2A (89 TRACE_TO_POINT live → 87
-- SAFE_SINGLE_TRACE_THREAD, 2 OCEF NEEDS_SCOPE_REFINEMENT). 6E.2B = UN SEUL pilote réel
-- d'association trace→Point, source SAFE_SINGLE_TRACE_THREAD à cible unique. HARD STOP
-- avant tout traitement des 86 autres candidats sûrs, des 2 NEEDS_SCOPE_REFINEMENT, ou des
-- 433 tracked_point_pending_trace (6E.3).
--
-- Contrairement à merge_tracked_points (391/392), cette primitive n'exécute PAS de
-- redirection Point→Point : elle transforme un rattachement candidat (thread pending) en
-- membership HARD scope='thread' sur le Point cible désigné, en une seule transaction :
--   candidate pending → revalidation live → INSERT tracked_point_member (HARD, thread)
--                                          → UPDATE candidate SET status='accepted'
-- Aucun état intermédiaire n'est jamais observable (tout-ou-rien, comme 391/392).
--
-- Checklist Vincent → guard :
--   - candidate introuvable                        → guard 1
--   - candidate.status ≠ pending                     → guard 2 (SAUF branche idempotence
--                                                       ci-dessous, qui gère explicitement
--                                                       status='accepted' AVEC membership
--                                                       déjà posée : ALREADY_ASSOCIATED)
--   - candidate.scope ≠ 'thread'                     → guard 3 (proposal_set hors périmètre
--                                                       6E.2B, laissé à un futur lot)
--   - target introuvable                             → guard 4
--   - target.status ≠ 'active' (y compris 'merged' :  → guard 5 — ne suit JAMAIS
--     jamais suivre merged_into_id silencieusement)     merged_into_id, échoue explicitement
--   - target.identity_status = CONFLICTED             → guard 6
--   - cross-site (candidate.site_id ≠ target.site_id) → guard 7
--   - source déjà fondatrice/membre HARD d'un AUTRE
--     point (devenue POINT_TO_POINT depuis la pose
--     du candidat)                                    → guard 8 : STALE_NOW_POINT_TO_POINT
--   - déjà associée (membership HARD active vers la
--     cible déjà présente)                            → guard 9 : idempotence,
--                                                        ALREADY_ASSOCIATED, 0 écriture
--
-- Volontairement HORS SQL (doctrine explicite Vincent, "pas hardcodé en SQL") : l'homogénéité
-- de famille (SAFE_SINGLE_TRACE_THREAD vs NEEDS_SCOPE_REFINEMENT) exige une jointure vers
-- document_extraction_proposal.proposal_family, absente de cette fonction. Le CALLER
-- (lib/db/tracked-point-trace-acceptance.ts) DOIT revalider live via
-- classifyTraceIdentityCandidate (lib/knowledge/tracked-point-trace-scope.ts) et n'appeler
-- cette RPC QUE si la classification renvoie SAFE_SINGLE_TRACE_THREAD, juste avant l'appel —
-- jamais une liste figée ("87 safe au 08/09" est un instantané, pas une garantie éternelle).

CREATE OR REPLACE FUNCTION accept_trace_identity_candidate(
  p_candidate_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_candidate tracked_point_identity_candidate%ROWTYPE;
  v_target tracked_point%ROWTYPE;
  v_other_point_id uuid;
  v_attached boolean;
  v_existing_member_id uuid;
  v_new_member_id uuid;
BEGIN
  -- 1. Charger + verrouiller le candidat
  SELECT * INTO v_candidate FROM public.tracked_point_identity_candidate WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accept_trace_identity_candidate: candidate introuvable (%)', p_candidate_id;
  END IF;

  -- 1bis. Idempotence explicite : rejeu sur un candidat déjà accepté. Doit trouver EXACTEMENT
  -- une membership active correspondante — sinon l'invariant "accepted ⟺ membership posée"
  -- est déjà rompu ailleurs, ce qui doit échouer bruyamment plutôt que reposer une ligne.
  IF v_candidate.status = 'accepted' THEN
    SELECT id INTO v_existing_member_id
    FROM public.tracked_point_member
    WHERE subject_thread_id = v_candidate.subject_thread_id
      AND scope = 'thread'
      AND status = 'active'
    LIMIT 1;
    IF v_existing_member_id IS NULL THEN
      RAISE EXCEPTION 'accept_trace_identity_candidate: candidate (%) déjà accepted mais aucune membership active correspondante (invariant rompu)', p_candidate_id;
    END IF;
    RETURN jsonb_build_object(
      'candidateId', p_candidate_id,
      'alreadyAssociated', true,
      'targetPointId', v_candidate.candidate_point_id,
      'sourceThreadId', v_candidate.subject_thread_id,
      'memberId', v_existing_member_id,
      'membershipInserted', false
    );
  END IF;

  -- 2. status pending requis (rejected exclu explicitement — jamais reposé silencieusement)
  IF v_candidate.status <> 'pending' THEN
    RAISE EXCEPTION 'accept_trace_identity_candidate: candidate (%) status=% (attendu pending)', p_candidate_id, v_candidate.status;
  END IF;

  -- 3. scope='thread' uniquement — proposal_set hors périmètre 6E.2B
  IF v_candidate.scope <> 'thread' THEN
    RAISE EXCEPTION 'accept_trace_identity_candidate: candidate (%) scope=% (attendu thread)', p_candidate_id, v_candidate.scope;
  END IF;

  -- 4. Charger + verrouiller la cible LITTÉRALE (jamais résolue via merged_into_id ici :
  -- si elle a été fusionnée depuis, le guard 5 ci-dessous échoue explicitement plutôt que
  -- de suivre silencieusement la redirection).
  SELECT * INTO v_target FROM public.tracked_point WHERE id = v_candidate.candidate_point_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accept_trace_identity_candidate: target introuvable (%)', v_candidate.candidate_point_id;
  END IF;

  -- 5. target active (STALE_TARGET style : merged/retired refusés, jamais suivis)
  IF v_target.status <> 'active' THEN
    RAISE EXCEPTION 'accept_trace_identity_candidate: STALE_TARGET — target (%) status=% (attendu active)', v_candidate.candidate_point_id, v_target.status;
  END IF;

  -- 6. target non CONFLICTED
  IF v_target.identity_status = 'CONFLICTED' THEN
    RAISE EXCEPTION 'accept_trace_identity_candidate: target (%) identity_status=CONFLICTED — association automatique interdite', v_candidate.candidate_point_id;
  END IF;

  -- 7. même site
  IF v_candidate.site_id <> v_target.site_id THEN
    RAISE EXCEPTION 'accept_trace_identity_candidate: candidate site_id=% différent du target site_id=%', v_candidate.site_id, v_target.site_id;
  END IF;

  -- 8. STALE_NOW_POINT_TO_POINT : la source ne doit pas être devenue fondatrice/membre HARD
  -- d'un AUTRE point que la cible depuis la pose du candidat (trois mêmes mécanismes que
  -- deriveCandidatePointPairs / merge_tracked_points guard 7bis, appliqués ici en excluant
  -- explicitement la cible elle-même).
  SELECT EXISTS (
    SELECT 1 FROM public.tracked_point tp
    WHERE tp.founding_kind = 'trackable_condition'
      AND tp.founding_reference = v_candidate.subject_thread_id::text
      AND tp.id <> v_candidate.candidate_point_id
  ) OR EXISTS (
    SELECT 1 FROM public.tracked_point_member tpm
    WHERE tpm.subject_thread_id = v_candidate.subject_thread_id
      AND tpm.status = 'active'
      AND tpm.tracked_point_id <> v_candidate.candidate_point_id
  ) INTO v_attached;

  IF v_attached THEN
    RAISE EXCEPTION 'accept_trace_identity_candidate: STALE_NOW_POINT_TO_POINT — source (thread %) rattachée à un autre point que la cible (%) depuis la pose du candidat', v_candidate.subject_thread_id, v_candidate.candidate_point_id;
  END IF;

  -- 9. ALREADY_ASSOCIATED (idempotence sur candidat encore pending, ex. écriture concurrente
  -- posée par un autre chemin) : membership active déjà présente vers cette cible précise.
  SELECT id INTO v_existing_member_id
  FROM public.tracked_point_member
  WHERE tracked_point_id = v_candidate.candidate_point_id
    AND subject_thread_id = v_candidate.subject_thread_id
    AND scope = 'thread'
    AND status = 'active'
  LIMIT 1;

  IF v_existing_member_id IS NOT NULL THEN
    UPDATE public.tracked_point_identity_candidate
    SET status = 'accepted', resolved_at = now()
    WHERE id = p_candidate_id;

    RETURN jsonb_build_object(
      'candidateId', p_candidate_id,
      'alreadyAssociated', true,
      'targetPointId', v_candidate.candidate_point_id,
      'sourceThreadId', v_candidate.subject_thread_id,
      'memberId', v_existing_member_id,
      'membershipInserted', false
    );
  END IF;

  -- 10. Écriture atomique : +1 membership HARD scope=thread, candidate → accepted.
  INSERT INTO public.tracked_point_member (
    tracked_point_id, subject_thread_id, scope, proposal_ids, status,
    resolution_source, evidence_grade
  ) VALUES (
    v_candidate.candidate_point_id, v_candidate.subject_thread_id, 'thread', NULL, 'active',
    'manual', 'HARD'
  ) RETURNING id INTO v_new_member_id;

  UPDATE public.tracked_point_identity_candidate
  SET status = 'accepted', resolved_at = now()
  WHERE id = p_candidate_id;

  RETURN jsonb_build_object(
    'candidateId', p_candidate_id,
    'alreadyAssociated', false,
    'targetPointId', v_candidate.candidate_point_id,
    'sourceThreadId', v_candidate.subject_thread_id,
    'memberId', v_new_member_id,
    'membershipInserted', true
  );
END;
$$;

COMMENT ON FUNCTION accept_trace_identity_candidate(uuid) IS
  'Phase 6E.2B — pilote réel TRACE_TO_POINT : acceptation atomique d''UN candidat scope=thread en membership HARD sur le Point cible (pending→accepted + INSERT tracked_point_member). Revalidation live (existence, statuts, site, CONFLICTED, dérive vers un autre point, idempotence) ; l''homogénéité de famille (SAFE_SINGLE_TRACE_THREAD) est revalidée EN AMONT côté TS (classifyTraceIdentityCandidate), jamais hardcodée ici. Pilote HARD STOP : un seul candidat par appel, aucun traitement en masse.';
