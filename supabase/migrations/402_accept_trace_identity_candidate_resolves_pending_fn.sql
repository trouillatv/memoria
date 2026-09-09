-- Migration 402 : accept_trace_identity_candidate ferme désormais la question IDENTITY_UNRESOLVED
-- (Round 7, Vincent — via revue ChatGPT du rapport Round 6).
--
-- Constat (audit ciblé, aucune écriture) : la migration 393 (accept_trace_identity_candidate)
-- pose une membership HARD scope=thread et fait passer le candidat en 'accepted', mais ne touche
-- JAMAIS tracked_point_pending_trace. Or la Branche A dégradée de fn_reconcile_tracked_point_unit
-- (migration 401, §7.5) matérialise pour ce même thread une tracked_point_pending_trace
-- kind='IDENTITY_UNRESOLVED' status='pending' (au plus une, cf. l'index partiel unique de la
-- migration 390 sur (source_thread_id, kind, COALESCE(source_proposal_id, NIL)) — IDENTITY_UNRESOLVED
-- a toujours source_proposal_id=NULL, cf. fallbackPendingTraceForUnit). Sans ce correctif, une
-- acceptation humaine réussie laisse cette pending trace 'pending' indéfiniment : invisible (le
-- Blocker 1 / Round 6 l'exclut explicitement de loadEvidenceScopeQueue, cf.
-- tracked-point-evidence-scope-queue.ts) et jamais reprise par un futur import tant qu'aucun
-- nouveau document ne retouche ce thread précis. Doctrine Vincent : "une ambiguïté explicitement
-- matérialisée comme IDENTITY_UNRESOLVED ne doit jamais devenir une dette pending invisible."
--
-- Correctif minimal, calqué sur le PRÉCÉDENT déjà établi par associate_pending_resolution_to_point
-- (migration 396 : membership + pending resolved + target_point_id + resolved_at, en une seule
-- transaction) — mais ADAPTÉ ici : accept_trace_identity_candidate ne reçoit pas le pending_trace_id
-- en paramètre (contrairement à 396, appelé depuis une file dédiée à la pending trace elle-même),
-- il le retrouve par (source_thread_id, kind='IDENTITY_UNRESOLVED', status='pending') — au plus
-- une ligne possible par l'index unique ci-dessus. Aucun paramètre de signature ajouté : callers
-- TS inchangés (accept_trace_identity_candidate(p_candidate_id uuid) identique).
--
-- Portée volontairement étroite : seul kind='IDENTITY_UNRESOLVED' est fermé ici. Un thread ayant
-- par ailleurs une pending trace TRACKABILITY_UNDETERMINED ou RESOLUTION_WITHOUT_KNOWN_PROBLEM
-- (Branche B, question distincte "faut-il suivre ?" / "quelle preuve ?") n'est jamais affecté —
-- l'UPDATE ci-dessous filtre explicitement sur ce kind, jamais un WHERE source_thread_id seul
-- (même discipline que le correctif Round 6 sur la contamination cross-kind, migration 401 §D1).
--
-- Ne répond PAS à la question B du mandat Round 7 (rejet du DERNIER candidat pending d'un thread,
-- pending trace qui reste ouverte sans qu'aucune membership n'existe) : aucun target_point_id
-- n'est alors disponible pour honorer la contrainte tracked_point_pending_trace_target_consistency
-- (target_point_id IS NOT NULL ⟺ status='resolved'). Cf. rapport HARD STOP Round 7 — proposition
-- de fermeture minimale documentée mais NON implémentée ce lot.

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
  v_identity_pending_trace_id uuid;
  v_identity_pending_resolved boolean;
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

    -- Round 7 : rejeu sur un candidat déjà accepté — si la pending trace IDENTITY_UNRESOLVED de
    -- ce thread est encore 'pending' (ex. acceptée avant ce correctif), la fermer maintenant.
    -- Sinon (déjà resolved par le premier appel), 0 ligne affectée — jamais une 2e écriture.
    UPDATE public.tracked_point_pending_trace
    SET status = 'resolved', target_point_id = v_candidate.candidate_point_id, resolved_at = now()
    WHERE source_thread_id = v_candidate.subject_thread_id
      AND kind = 'IDENTITY_UNRESOLVED'
      AND status = 'pending'
    RETURNING id INTO v_identity_pending_trace_id;
    v_identity_pending_resolved := (v_identity_pending_trace_id IS NOT NULL);

    RETURN jsonb_build_object(
      'candidateId', p_candidate_id,
      'alreadyAssociated', true,
      'targetPointId', v_candidate.candidate_point_id,
      'sourceThreadId', v_candidate.subject_thread_id,
      'memberId', v_existing_member_id,
      'membershipInserted', false,
      'identityPendingTraceResolved', v_identity_pending_resolved,
      'identityPendingTraceId', v_identity_pending_trace_id
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

    -- Round 7 : même fermeture que la branche succès ci-dessous — cette branche pose elle
    -- aussi la question "vers quel Point ?" comme tranchée.
    UPDATE public.tracked_point_pending_trace
    SET status = 'resolved', target_point_id = v_candidate.candidate_point_id, resolved_at = now()
    WHERE source_thread_id = v_candidate.subject_thread_id
      AND kind = 'IDENTITY_UNRESOLVED'
      AND status = 'pending'
    RETURNING id INTO v_identity_pending_trace_id;
    v_identity_pending_resolved := (v_identity_pending_trace_id IS NOT NULL);

    RETURN jsonb_build_object(
      'candidateId', p_candidate_id,
      'alreadyAssociated', true,
      'targetPointId', v_candidate.candidate_point_id,
      'sourceThreadId', v_candidate.subject_thread_id,
      'memberId', v_existing_member_id,
      'membershipInserted', false,
      'identityPendingTraceResolved', v_identity_pending_resolved,
      'identityPendingTraceId', v_identity_pending_trace_id
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

  -- Round 7 : fermeture atomique de la question IDENTITY_UNRESOLVED de ce thread, dans la MÊME
  -- transaction que la membership — jamais un état intermédiaire observable où le candidat est
  -- 'accepted' mais la pending trace encore 'pending'. 0 ligne affectée si aucune pending trace
  -- IDENTITY_UNRESOLVED n'existait pour ce thread (ex. candidat posé hors Branche A dégradée).
  UPDATE public.tracked_point_pending_trace
  SET status = 'resolved', target_point_id = v_candidate.candidate_point_id, resolved_at = now()
  WHERE source_thread_id = v_candidate.subject_thread_id
    AND kind = 'IDENTITY_UNRESOLVED'
    AND status = 'pending'
  RETURNING id INTO v_identity_pending_trace_id;
  v_identity_pending_resolved := (v_identity_pending_trace_id IS NOT NULL);

  RETURN jsonb_build_object(
    'candidateId', p_candidate_id,
    'alreadyAssociated', false,
    'targetPointId', v_candidate.candidate_point_id,
    'sourceThreadId', v_candidate.subject_thread_id,
    'memberId', v_new_member_id,
    'membershipInserted', true,
    'identityPendingTraceResolved', v_identity_pending_resolved,
    'identityPendingTraceId', v_identity_pending_trace_id
  );
END;
$$;

COMMENT ON FUNCTION accept_trace_identity_candidate(uuid) IS
  'Phase 6E.2B (pilote réel TRACE_TO_POINT) + Round 7 (fermeture IDENTITY_UNRESOLVED) : acceptation atomique d''UN candidat scope=thread en membership HARD sur le Point cible (pending→accepted + INSERT tracked_point_member), ET fermeture de la question d''identité elle-même — toute tracked_point_pending_trace kind=IDENTITY_UNRESOLVED status=pending sur le MÊME thread passe à resolved (target_point_id=cible, resolved_at=now()) dans la même transaction, y compris sur les branches idempotentes (déjà accepted, déjà associée). Portée strictement limitée à ce kind — jamais TRACKABILITY_UNDETERMINED ni RESOLUTION_WITHOUT_KNOWN_PROBLEM (question distincte, Branche B). Revalidation live (existence, statuts, site, CONFLICTED, dérive vers un autre point, idempotence) inchangée ; l''homogénéité de famille (SAFE_SINGLE_TRACE_THREAD) reste revalidée EN AMONT côté TS (classifyTraceIdentityCandidate), jamais hardcodée ici. Ne traite pas le rejet du dernier candidat pending d''un thread (aucun target_point_id disponible) — cf. rapport HARD STOP Round 7.';
