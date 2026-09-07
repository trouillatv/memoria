-- Migration 396 : associate_pending_resolution_to_point (Phase 6E.3B.3B)
--
-- GO explicite de Vincent après PASS/CLOSE de 6E.3B.3A (audit live : 155
-- RESOLUTION_WITHOUT_KNOWN_PROBLEM evidence-ready, 6 READY_SINGLE_KNOWN_TARGET, 1
-- READY_MULTI_KNOWN_TARGET, 6 READY_SINGLE_SUBJECT_SUGGESTION, 28
-- READY_MULTI_SUBJECT_SUGGESTION, 114 READY_NO_LOCAL_TARGET — la difficulté
-- principale n'est plus la provenance documentaire (figée par 394) mais
-- l'identification du Point cible). 6E.3B.3B = UN SEUL pilote réel : associer une
-- pending trace RESOLUTION_WITHOUT_KNOWN_PROBLEM (evidence déjà figée par 394) à
-- un Point EXISTANT explicitement désigné par l'humain — jamais un Point nouveau
-- (contrairement à 395/6E.3B.2). « Une résolution orpheline ne fonde pas un
-- Point. »
--
-- Doctrine explicite de Vincent (à ne jamais dévier) : identity_candidate répond
-- à « vers quel Point ? », pending_trace_evidence répond à « avec quelle preuve
-- ? » — deux questions séparées, jamais fusionnées. La membership créée ici est
-- TOUJOURS scope='proposal_set' avec EXACTEMENT l'evidence figée par 394, quel
-- que soit le scope du candidat historique (même s'il est scope='thread' —
-- accept_trace_identity_candidate/393 répond à une question différente : « ce
-- thread entier est-il ce Point ? »). p_identity_candidate_id est optionnel :
-- seul le candidat EXACT utilisé pour cette décision humaine est mis à jour, et
-- seulement si sa cohérence live est revérifiée — jamais un autre candidat du
-- même thread n'est touché.
--
-- Une seule transaction, tout-ou-rien, comme 391/392/393/395 :
--   pending → revalidation live (kind, status, evidence figée par 394)
--           → target → revalidation live (existe, active, non-CONFLICTED, même site)
--           → [candidat optionnel] → revalidation live (toujours pending, thread/cible inchangés)
--           → INSERT tracked_point_member (HARD, proposal_set, evidence 394 exacte)
--           → UPDATE pending SET status='resolved', target_point_id=cible
--           → [candidat optionnel] UPDATE candidate SET status='accepted'
--
-- Checklist Vincent → guard :
--   - pending introuvable                                → guard 1
--   - kind ≠ RESOLUTION_WITHOUT_KNOWN_PROBLEM            → guard 2 : INVALID_KIND
--     (TRACKABILITY_UNDETERMINED fonde son propre Point via confirm_pending_trackability/395,
--     jamais via cette fonction)
--   - status = 'dismissed'                               → guard 3 : INVALID_STATUS
--   - status = 'resolved' vers CE MÊME target             → guard 4a : idempotence,
--     ALREADY_RESOLVED, 0 écriture (vérifie la membership HARD proposal_set exacte)
--   - status = 'resolved' vers un AUTRE target             → guard 4b : TARGET_MISMATCH
--     (jamais une réassignation silencieuse — une correction future sera une
--     opération explicite séparée, jamais un second appel de cette fonction)
--   - evidence_status ≠ 'resolved'                        → guard 6 : EVIDENCE_SCOPE_UNRESOLVED
--   - 0 ligne d'evidence (défensif — 394 garantit resolved⟺≥1 ligne)
--                                                          → guard 7 : EVIDENCE_MISSING
--   - une proposition figée n'appartient plus au thread source (défensif, drift)
--                                                          → guard 8 : EVIDENCE_SCOPE_INVALID
--   - target introuvable                                  → guard 9 : INVALID_TARGET
--   - target.status = 'merged' (jamais suivre merged_into_id)
--                                                          → guard 10 : STALE_TARGET
--   - target.status = 'retired'                           → guard 11 : INVALID_TARGET
--   - target.identity_status = 'CONFLICTED'                → guard 12 : TARGET_CONFLICTED
--   - cross-site (pending.site_id ≠ target.site_id), TOUJOURS → guard 13 : ABORT
--   - candidat fourni mais thread/cible ne correspondent plus, ou status ≠ pending
--                                                          → guard 14 : STALE_CANDIDATE
--   - thread source déjà membre HARD actif d'un AUTRE Point que la cible
--                                                          → guard 15 : STALE_ALREADY_CONSUMED
--   - membership HARD proposal_set équivalente déjà active vers CETTE cible
--                                                          → guard 16 : idempotence,
--     ALREADY_ASSOCIATED, 0 nouvelle membership (finalise pending + candidat)
--
-- Non-buts explicites (doivent être vérifiables après coup) : +0 tracked_point
-- créé, +0 canonical_business_object créé, +0 merge exécuté, +0 modification
-- d'un AUTRE Point que la cible désignée. Cette fonction n'écrit jamais dans
-- tracked_point, jamais dans canonical_business_object — seulement
-- tracked_point_member (insert) + tracked_point_pending_trace (update) +
-- tracked_point_identity_candidate (update, au plus une ligne).
--
-- Concurrence : verrouillage FOR UPDATE de la pending, puis du target, puis du
-- candidat (ordre stable, évite les deadlocks croisés avec accept_trace_identity_candidate
-- qui verrouille candidat puis target).

CREATE OR REPLACE FUNCTION public.associate_pending_resolution_to_point(
  p_pending_trace_id UUID,
  p_target_point_id UUID,
  p_identity_candidate_id UUID DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending              public.tracked_point_pending_trace%ROWTYPE;
  v_target               public.tracked_point%ROWTYPE;
  v_candidate            public.tracked_point_identity_candidate%ROWTYPE;
  v_evidence_ids         UUID[];
  v_evidence_thread_hits INT;
  v_existing_member_id   UUID;
  v_other_member_id      UUID;
  v_new_member_id        UUID;
  v_candidate_accepted   BOOLEAN := false;
BEGIN
  -- 1. Charger + verrouiller le pending
  SELECT * INTO v_pending FROM public.tracked_point_pending_trace WHERE id = p_pending_trace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: pending trace introuvable (%)', p_pending_trace_id;
  END IF;

  -- 2. INVALID_KIND — seule RESOLUTION_WITHOUT_KNOWN_PROBLEM peut être associée ici
  IF v_pending.kind <> 'RESOLUTION_WITHOUT_KNOWN_PROBLEM' THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: INVALID_KIND — pending trace (%) kind=% (attendu RESOLUTION_WITHOUT_KNOWN_PROBLEM ; TRACKABILITY_UNDETERMINED passe par confirm_pending_trackability)',
      p_pending_trace_id, v_pending.kind;
  END IF;

  -- 3. INVALID_STATUS — dismissed n'est jamais reconfirmable
  IF v_pending.status = 'dismissed' THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: INVALID_STATUS — pending trace (%) status=dismissed, jamais reconfirmable', p_pending_trace_id;
  END IF;

  -- 4. Idempotence explicite si déjà resolved.
  IF v_pending.status = 'resolved' THEN
    -- 4b. TARGET_MISMATCH — jamais une réassignation silencieuse vers une autre cible.
    IF v_pending.target_point_id <> p_target_point_id THEN
      RAISE EXCEPTION 'associate_pending_resolution_to_point: TARGET_MISMATCH — pending trace (%) déjà resolved vers target=% (demandé target=%) ; une correction de cible est une opération explicite séparée, jamais un second appel',
        p_pending_trace_id, v_pending.target_point_id, p_target_point_id;
    END IF;

    -- 4a. ALREADY_RESOLVED — même cible, vérifie l'invariant plutôt qu'un no-op silencieux.
    SELECT id INTO v_existing_member_id
    FROM public.tracked_point_member
    WHERE tracked_point_id = v_pending.target_point_id
      AND subject_thread_id = v_pending.source_thread_id
      AND scope = 'proposal_set'
      AND status = 'active'
    LIMIT 1;

    IF v_existing_member_id IS NULL THEN
      RAISE EXCEPTION 'associate_pending_resolution_to_point: pending trace (%) resolved vers Point (%) mais aucune membership HARD proposal_set active correspondante (invariant rompu)',
        p_pending_trace_id, v_pending.target_point_id;
    END IF;

    RETURN jsonb_build_object(
      'pendingTraceId', p_pending_trace_id,
      'result', 'already_resolved',
      'targetPointId', v_pending.target_point_id,
      'sourceThreadId', v_pending.source_thread_id,
      'memberId', v_existing_member_id,
      'membershipInserted', false,
      'candidateAccepted', false
    );
  END IF;

  -- 5. Défensif : seul 'pending' doit subsister ici (CHECK mig 390 exclut toute autre valeur)
  IF v_pending.status <> 'pending' THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: INVALID_STATUS — pending trace (%) status=% (attendu pending)', p_pending_trace_id, v_pending.status;
  END IF;

  -- 6. EVIDENCE_SCOPE_UNRESOLVED — la portée de preuve doit avoir été figée par 394
  IF v_pending.evidence_status <> 'resolved' THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: EVIDENCE_SCOPE_UNRESOLVED — pending trace (%) evidence_status=% (attendu resolved via resolve_pending_trace_evidence)',
      p_pending_trace_id, v_pending.evidence_status;
  END IF;

  -- 7. EVIDENCE_MISSING — défensif (394 garantit resolved ⟺ ≥1 ligne d'evidence)
  SELECT array_agg(proposal_id ORDER BY proposal_id) INTO v_evidence_ids
  FROM public.tracked_point_pending_trace_evidence WHERE pending_trace_id = p_pending_trace_id;

  IF v_evidence_ids IS NULL OR array_length(v_evidence_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: EVIDENCE_MISSING — pending trace (%) evidence_status=resolved mais 0 ligne d''evidence (invariant rompu)', p_pending_trace_id;
  END IF;

  -- 8. EVIDENCE_SCOPE_INVALID — revalidation défensive à l'association (394 garde déjà
  -- l'écriture, ceci couvre un éventuel drift entretemps)
  SELECT count(*) INTO v_evidence_thread_hits
  FROM public.document_extraction_proposal
  WHERE id = ANY(v_evidence_ids) AND subject_thread_id = v_pending.source_thread_id;

  IF v_evidence_thread_hits <> array_length(v_evidence_ids, 1) THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: EVIDENCE_SCOPE_INVALID — % proposition(s) figée(s) sur % n''appartiennent plus au thread source (%) de la pending trace (%)',
      (array_length(v_evidence_ids, 1) - v_evidence_thread_hits), array_length(v_evidence_ids, 1), v_pending.source_thread_id, p_pending_trace_id;
  END IF;

  -- 9. Charger + verrouiller la cible LITTÉRALE (jamais résolue via merged_into_id)
  SELECT * INTO v_target FROM public.tracked_point WHERE id = p_target_point_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: INVALID_TARGET — target introuvable (%)', p_target_point_id;
  END IF;

  -- 10. STALE_TARGET — merged jamais suivi silencieusement
  IF v_target.status = 'merged' THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: STALE_TARGET — target (%) status=merged (vers %), jamais suivi automatiquement', p_target_point_id, v_target.merged_into_id;
  END IF;

  -- 11. INVALID_TARGET — retired (seule autre valeur possible que active/merged)
  IF v_target.status <> 'active' THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: INVALID_TARGET — target (%) status=% (attendu active)', p_target_point_id, v_target.status;
  END IF;

  -- 12. TARGET_CONFLICTED
  IF v_target.identity_status = 'CONFLICTED' THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: TARGET_CONFLICTED — target (%) identity_status=CONFLICTED, association humaine interdite', p_target_point_id;
  END IF;

  -- 13. ABORT — cross-site, toujours (jamais de rattachement d'une résolution d'un site vers
  -- un Point d'un autre site/chantier — invariant produit explicite de Vincent)
  IF v_pending.site_id <> v_target.site_id THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: ABORT — pending site_id=% différent du target site_id=%', v_pending.site_id, v_target.site_id;
  END IF;

  -- 14. STALE_CANDIDATE — si un candidat précis est fourni pour cette décision, il doit encore
  -- correspondre EXACTEMENT à ce thread, cette cible, et être encore pending.
  IF p_identity_candidate_id IS NOT NULL THEN
    SELECT * INTO v_candidate FROM public.tracked_point_identity_candidate WHERE id = p_identity_candidate_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'associate_pending_resolution_to_point: STALE_CANDIDATE — candidate introuvable (%)', p_identity_candidate_id;
    END IF;
    IF v_candidate.subject_thread_id <> v_pending.source_thread_id THEN
      RAISE EXCEPTION 'associate_pending_resolution_to_point: STALE_CANDIDATE — candidate (%) thread=% ne correspond plus au pending thread=%',
        p_identity_candidate_id, v_candidate.subject_thread_id, v_pending.source_thread_id;
    END IF;
    IF v_candidate.candidate_point_id <> p_target_point_id THEN
      RAISE EXCEPTION 'associate_pending_resolution_to_point: STALE_CANDIDATE — candidate (%) cible=% ne correspond plus à la cible demandée=%',
        p_identity_candidate_id, v_candidate.candidate_point_id, p_target_point_id;
    END IF;
    IF v_candidate.status <> 'pending' THEN
      RAISE EXCEPTION 'associate_pending_resolution_to_point: STALE_CANDIDATE — candidate (%) status=% (attendu pending)', p_identity_candidate_id, v_candidate.status;
    END IF;
  END IF;

  -- 15. STALE_ALREADY_CONSUMED — le thread source ne doit pas être déjà membre HARD actif
  -- d'un AUTRE Point que la cible (fondateur ou membership thread/proposal_set).
  SELECT tpm.id INTO v_other_member_id
  FROM public.tracked_point_member tpm
  WHERE tpm.subject_thread_id = v_pending.source_thread_id
    AND tpm.status = 'active'
    AND tpm.tracked_point_id <> p_target_point_id
  LIMIT 1;

  IF v_other_member_id IS NOT NULL THEN
    RAISE EXCEPTION 'associate_pending_resolution_to_point: STALE_ALREADY_CONSUMED — thread source (%) déjà membre HARD actif (%) d''un Point différent de la cible demandée (%)',
      v_pending.source_thread_id, v_other_member_id, p_target_point_id;
  END IF;

  -- 16. ALREADY_ASSOCIATED — membership HARD proposal_set équivalente déjà active vers CETTE
  -- cible précise (état incohérent avec pending encore 'pending', mais traité non-destructivement :
  -- finalise pending + candidat sur la base de la membership existante, 0 nouvelle membership).
  SELECT id INTO v_existing_member_id
  FROM public.tracked_point_member
  WHERE tracked_point_id = p_target_point_id
    AND subject_thread_id = v_pending.source_thread_id
    AND scope = 'proposal_set'
    AND status = 'active'
  LIMIT 1;

  IF v_existing_member_id IS NOT NULL THEN
    UPDATE public.tracked_point_pending_trace
    SET status = 'resolved', target_point_id = p_target_point_id, resolved_at = now()
    WHERE id = p_pending_trace_id;

    IF p_identity_candidate_id IS NOT NULL THEN
      UPDATE public.tracked_point_identity_candidate
      SET status = 'accepted', resolved_at = now()
      WHERE id = p_identity_candidate_id;
      v_candidate_accepted := true;
    END IF;

    RETURN jsonb_build_object(
      'pendingTraceId', p_pending_trace_id,
      'result', 'already_associated',
      'targetPointId', p_target_point_id,
      'sourceThreadId', v_pending.source_thread_id,
      'memberId', v_existing_member_id,
      'membershipInserted', false,
      'candidateAccepted', v_candidate_accepted
    );
  END IF;

  -- 17. Écriture atomique : +1 membership HARD proposal_set (evidence 394 exacte),
  -- pending → resolved, [candidat] → accepted.
  INSERT INTO public.tracked_point_member (
    tracked_point_id, subject_thread_id, scope, proposal_ids, status,
    resolution_source, evidence_grade
  ) VALUES (
    p_target_point_id, v_pending.source_thread_id, 'proposal_set', v_evidence_ids, 'active',
    'manual', 'HARD'
  ) RETURNING id INTO v_new_member_id;

  UPDATE public.tracked_point_pending_trace
  SET status = 'resolved', target_point_id = p_target_point_id, resolved_at = now()
  WHERE id = p_pending_trace_id;

  IF p_identity_candidate_id IS NOT NULL THEN
    UPDATE public.tracked_point_identity_candidate
    SET status = 'accepted', resolved_at = now()
    WHERE id = p_identity_candidate_id;
    v_candidate_accepted := true;
  END IF;

  RETURN jsonb_build_object(
    'pendingTraceId', p_pending_trace_id,
    'result', 'associated',
    'targetPointId', p_target_point_id,
    'sourceThreadId', v_pending.source_thread_id,
    'evidenceProposalIds', v_evidence_ids,
    'memberId', v_new_member_id,
    'membershipInserted', true,
    'candidateAccepted', v_candidate_accepted
  );
END;
$$;

COMMENT ON FUNCTION public.associate_pending_resolution_to_point(UUID, UUID, UUID) IS
  'Phase 6E.3B.3B — pilote réel : associe UNE pending trace RESOLUTION_WITHOUT_KNOWN_PROBLEM (evidence déjà figée par 394) à un Point EXISTANT désigné par l''humain, via UNE membership HARD scope=proposal_set (jamais thread, même si le candidat historique proposait scope=thread : identity_candidate répond à "vers quel Point ?", pending_trace_evidence répond à "avec quelle preuve ?" — jamais fusionnés). Ne fonde JAMAIS de nouveau Point ("une résolution orpheline ne fonde pas un Point" — contraste avec confirm_pending_trackability/395). p_identity_candidate_id optionnel, revalidé live (thread/cible/status), seul ce candidat exact est mis à jour. Revalidation complète (kind, status, evidence figée, target actif/non-CONFLICTED/non-merged, cross-site toujours ABORT, non-collision) ; idempotent sur rejeu identique (ALREADY_RESOLVED / ALREADY_ASSOCIATED), TARGET_MISMATCH bruyant si rejeu avec une cible différente (jamais de réassignation silencieuse). Pilote HARD STOP : une seule pending trace par appel, aucun traitement en masse, aucune UI.';
