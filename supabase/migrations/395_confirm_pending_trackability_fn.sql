-- Migration 395 : confirm_pending_trackability (Phase 6E.3B.2)
--
-- GO explicite de Vincent après PASS 6E.3B.1 (mig 394, provenance figée : 245
-- exact_single_proposal + 22 whole_thread_proven_safe résolus, 165 unresolved, 1
-- stale intouché, 0 effet sur tracked_point/tracked_point_member). 6E.3B.2 = UN SEUL
-- pilote réel : transformer une pending trace TRACKABILITY_UNDETERMINED (« ceci
-- mérite un suivi ») en un nouveau tracked_point PROVISIONAL + UNE membership HARD,
-- à partir d'une evidence déjà figée par 394 — jamais depuis un scope dynamique.
-- HARD STOP avant tout traitement en masse des 164 autres TRACKABILITY_UNDETERMINED
-- résolues, avant RESOLUTION_WITHOUT_KNOWN_PROBLEM (6E.3B.3, hors périmètre : cette
-- fonction refuse explicitement ce kind, cf. guard 2), et avant toute UI (6E.4).
--
-- Doctrine explicite de Vincent (à ne jamais dévier) : quand l'humain confirme
-- qu'une pending trace TRACKABILITY_UNDETERMINED mérite un suivi, il affirme
-- seulement l'existence d'une condition durable — jamais son état (ouvert, bloquant,
-- résolu). Le nouveau Point est donc TOUJOURS identity_status=PROVISIONAL,
-- founding_kind='manual' (jamais 'trackable_condition' : cette fondation est le
-- résultat explicite d'un arbitrage humain, pas de la doctrine automatique 5E), et
-- son derivedState reste ENTIÈREMENT produit par le réducteur (Phase 2, inchangé)
-- à partir de la trajectoire réelle — jamais imposé ici.
--
-- Membership scope='proposal_set' (jamais 'thread', même à 1 seule proposition) :
-- exactement la raison d'être de 394 — figer l'evidence exacte au moment de la
-- décision, pour qu'une proposition future sur le même thread n'entre jamais
-- rétroactivement dans ce Point.
--
-- Contrairement à accept_trace_identity_candidate (393, rattache une trace à un
-- Point EXISTANT désigné), cette primitive FONDE un Point NOUVEAU. Une seule
-- transaction, tout-ou-rien, comme 391/392/393 :
--   pending → revalidation live (kind, status, evidence figée par 394, non-collision)
--           → INSERT tracked_point (PROVISIONAL, manual)
--           → INSERT tracked_point_member (HARD, proposal_set, evidence 394 exacte)
--           → UPDATE pending SET status='resolved', target_point_id=nouveau Point
--
-- Checklist Vincent → guard :
--   - pending introuvable                              → guard 1
--   - kind ≠ TRACKABILITY_UNDETERMINED                 → guard 2 : INVALID_KIND
--     (RESOLUTION_WITHOUT_KNOWN_PROBLEM ne fonde JAMAIS son propre Point — 6E.3B.3,
--     hors périmètre, doctrine mig 389 § tracked_point_identity_candidate)
--   - status = 'dismissed'                              → guard 3 : INVALID_STATUS
--   - status = 'resolved' déjà par CETTE fonction        → idempotence, ALREADY_RESOLVED,
--     (founding_source = 'human_confirmed_pending_trackability' du target)  0 écriture
--   - status = 'resolved' mais PAS par cette fonction    → guard 4 : INVALID_STATUS
--     (invariant rompu ailleurs — échoue bruyamment, jamais un Point silencieux)
--   - evidence_status ≠ 'resolved'                      → guard 5 : EVIDENCE_SCOPE_UNRESOLVED
--   - 0 ligne d'evidence (défensif — 394 garantit resolved⟺≥1 ligne)
--                                                        → guard 6 : EVIDENCE_MISSING
--   - une proposition figée n'appartient plus au thread source (défensif — 394 a
--     déjà un trigger de garde à l'écriture, revérifié ici à la confirmation)
--                                                        → guard 7 : EVIDENCE_SCOPE_INVALID
--   - thread déjà fondateur/membre HARD d'un autre Point → guard 8 : STALE_ALREADY_TRACKED
--   - subject_thread_identity d'un autre site que le pending (cross-site défensif)
--                                                        → guard 9 : ABORT
--
-- target_point_id posé UNIQUEMENT par l'UPDATE final (cf. CHECK mig 390 :
-- target_point_id IS NOT NULL ⟺ status='resolved' — l'état « target présent mais
-- pending » que Vincent nomme STALE_PENDING est déjà rendu impossible par ce CHECK,
-- aucune revalidation applicative supplémentaire n'est nécessaire ici).
--
-- Concurrence : verrouillage FOR UPDATE de la ligne pending dès l'entrée — deux
-- appels concurrents sur le MÊME pending_trace_id se sérialisent (le second voit
-- soit ALREADY_RESOLVED, soit une exception si le premier a échoué et relâché le
-- verrou), garantissant qu'au plus UN Point est fondé par pending trace.
--
-- Label déterministe : aucun nouveau normaliseur. Reprend la convention déjà en
-- usage (scripts/_p6c-preflight-rus.ts, founding thread_seed) — le label de la
-- proposition la plus récente parmi l'evidence figée. Pour ce pilote (exactement 1
-- proposition), c'est directement le label de cette proposition.

CREATE OR REPLACE FUNCTION public.confirm_pending_trackability(
  p_pending_trace_id UUID
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending              public.tracked_point_pending_trace%ROWTYPE;
  v_existing_point       public.tracked_point%ROWTYPE;
  v_existing_member_id   UUID;
  v_evidence_ids         UUID[];
  v_evidence_thread_hits INT;
  v_canonical_subject_id UUID;
  v_thread_site_id       UUID;
  v_label                TEXT;
  v_new_point_id         UUID;
  v_new_member_id        UUID;
BEGIN
  -- 1. Charger + verrouiller le pending
  SELECT * INTO v_pending FROM public.tracked_point_pending_trace WHERE id = p_pending_trace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_pending_trackability: pending trace introuvable (%)', p_pending_trace_id;
  END IF;

  -- 2. INVALID_KIND — seule TRACKABILITY_UNDETERMINED peut fonder un Point ici
  IF v_pending.kind <> 'TRACKABILITY_UNDETERMINED' THEN
    RAISE EXCEPTION 'confirm_pending_trackability: INVALID_KIND — pending trace (%) kind=% (attendu TRACKABILITY_UNDETERMINED ; RESOLUTION_WITHOUT_KNOWN_PROBLEM hors périmètre 6E.3B.2)',
      p_pending_trace_id, v_pending.kind;
  END IF;

  -- 3. INVALID_STATUS — dismissed n'est jamais reconfirmable
  IF v_pending.status = 'dismissed' THEN
    RAISE EXCEPTION 'confirm_pending_trackability: INVALID_STATUS — pending trace (%) status=dismissed, jamais reconfirmable', p_pending_trace_id;
  END IF;

  -- 4. Idempotence explicite si déjà resolved : doit être resolved PAR CETTE fonction
  -- (founding_source dédié) avec une membership HARD proposal_set correspondante —
  -- sinon l'invariant est déjà rompu ailleurs, échec bruyant plutôt qu'un no-op silencieux.
  IF v_pending.status = 'resolved' THEN
    SELECT * INTO v_existing_point
    FROM public.tracked_point
    WHERE id = v_pending.target_point_id
      AND founding_kind = 'manual'
      AND founding_source = 'human_confirmed_pending_trackability'
      AND founding_reference = p_pending_trace_id::text;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'confirm_pending_trackability: INVALID_STATUS — pending trace (%) déjà resolved (target=%) mais pas par confirm_pending_trackability (invariant rompu)',
        p_pending_trace_id, v_pending.target_point_id;
    END IF;

    SELECT id INTO v_existing_member_id
    FROM public.tracked_point_member
    WHERE tracked_point_id = v_existing_point.id
      AND subject_thread_id = v_pending.source_thread_id
      AND scope = 'proposal_set'
      AND status = 'active'
    LIMIT 1;

    IF v_existing_member_id IS NULL THEN
      RAISE EXCEPTION 'confirm_pending_trackability: pending trace (%) resolved vers Point (%) mais aucune membership HARD proposal_set active correspondante (invariant rompu)',
        p_pending_trace_id, v_existing_point.id;
    END IF;

    RETURN jsonb_build_object(
      'pendingTraceId', p_pending_trace_id,
      'result', 'already_resolved',
      'targetPointId', v_existing_point.id,
      'sourceThreadId', v_pending.source_thread_id,
      'memberId', v_existing_member_id,
      'pointCreated', false,
      'membershipInserted', false
    );
  END IF;

  -- 5. Défensif : seul 'pending' doit subsister ici (CHECK mig 390 exclut toute autre valeur)
  IF v_pending.status <> 'pending' THEN
    RAISE EXCEPTION 'confirm_pending_trackability: INVALID_STATUS — pending trace (%) status=% (attendu pending)', p_pending_trace_id, v_pending.status;
  END IF;

  -- 6. EVIDENCE_SCOPE_UNRESOLVED — la portée de preuve doit avoir été figée par 394
  IF v_pending.evidence_status <> 'resolved' THEN
    RAISE EXCEPTION 'confirm_pending_trackability: EVIDENCE_SCOPE_UNRESOLVED — pending trace (%) evidence_status=% (attendu resolved via resolve_pending_trace_evidence)',
      p_pending_trace_id, v_pending.evidence_status;
  END IF;

  -- 7. EVIDENCE_MISSING — défensif (394 garantit resolved ⟺ ≥1 ligne d'evidence)
  SELECT array_agg(proposal_id ORDER BY proposal_id) INTO v_evidence_ids
  FROM public.tracked_point_pending_trace_evidence WHERE pending_trace_id = p_pending_trace_id;

  IF v_evidence_ids IS NULL OR array_length(v_evidence_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'confirm_pending_trackability: EVIDENCE_MISSING — pending trace (%) evidence_status=resolved mais 0 ligne d''evidence (invariant rompu)', p_pending_trace_id;
  END IF;

  -- 8. EVIDENCE_SCOPE_INVALID — revalidation défensive à la confirmation (394 garde déjà
  -- l'écriture, ceci couvre un éventuel drift entretemps)
  SELECT count(*) INTO v_evidence_thread_hits
  FROM public.document_extraction_proposal
  WHERE id = ANY(v_evidence_ids) AND subject_thread_id = v_pending.source_thread_id;

  IF v_evidence_thread_hits <> array_length(v_evidence_ids, 1) THEN
    RAISE EXCEPTION 'confirm_pending_trackability: EVIDENCE_SCOPE_INVALID — % proposition(s) figée(s) sur % n''appartiennent plus au thread source (%) de la pending trace (%)',
      (array_length(v_evidence_ids, 1) - v_evidence_thread_hits), array_length(v_evidence_ids, 1), v_pending.source_thread_id, p_pending_trace_id;
  END IF;

  -- 9. STALE_ALREADY_TRACKED — le thread source ne doit être ni fondateur ni membre HARD
  -- d'aucun Point (même mécanisme que accept_trace_identity_candidate guard 8, migration 393)
  IF EXISTS (
    SELECT 1 FROM public.tracked_point tp
    WHERE tp.site_id = v_pending.site_id AND tp.founding_reference = v_pending.source_thread_id::text
  ) OR EXISTS (
    SELECT 1 FROM public.tracked_point_member tpm
    WHERE tpm.subject_thread_id = v_pending.source_thread_id AND tpm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'confirm_pending_trackability: STALE_ALREADY_TRACKED — thread source (%) déjà fondateur/membre HARD d''un Point depuis la résolution de l''evidence (%)',
      v_pending.source_thread_id, p_pending_trace_id;
  END IF;

  -- 10. ABORT — cross-site défensif (subject_thread_identity d'un autre site que le pending)
  SELECT site_id, canonical_subject_id INTO v_thread_site_id, v_canonical_subject_id
  FROM public.subject_thread_identity WHERE subject_thread_id = v_pending.source_thread_id;

  IF v_thread_site_id IS NOT NULL AND v_thread_site_id <> v_pending.site_id THEN
    RAISE EXCEPTION 'confirm_pending_trackability: ABORT — subject_thread_identity du thread (%) site_id=% différent du pending site_id=%',
      v_pending.source_thread_id, v_thread_site_id, v_pending.site_id;
  END IF;

  -- 11. Label déterministe : proposition la plus récente parmi l'evidence figée
  -- (convention existante, scripts/_p6c-preflight-rus.ts — aucun nouveau normaliseur)
  SELECT label INTO v_label
  FROM public.document_extraction_proposal
  WHERE id = ANY(v_evidence_ids)
  ORDER BY created_at DESC
  LIMIT 1;

  -- 12. Écriture atomique : +1 Point PROVISIONAL/manual, +1 membership HARD proposal_set,
  -- pending → resolved.
  INSERT INTO public.tracked_point (
    site_id, canonical_subject_id, label, status, identity_status,
    seed_source, founding_kind, founding_source, founding_reference, has_upstream_defect
  ) VALUES (
    v_pending.site_id, v_canonical_subject_id, v_label, 'active', 'PROVISIONAL',
    'manual', 'manual', 'human_confirmed_pending_trackability', p_pending_trace_id::text, false
  ) RETURNING id INTO v_new_point_id;

  INSERT INTO public.tracked_point_member (
    tracked_point_id, subject_thread_id, scope, proposal_ids, status,
    resolution_source, evidence_grade
  ) VALUES (
    v_new_point_id, v_pending.source_thread_id, 'proposal_set', v_evidence_ids, 'active',
    'manual', 'HARD'
  ) RETURNING id INTO v_new_member_id;

  UPDATE public.tracked_point_pending_trace
  SET status = 'resolved', target_point_id = v_new_point_id, resolved_at = now()
  WHERE id = p_pending_trace_id;

  RETURN jsonb_build_object(
    'pendingTraceId', p_pending_trace_id,
    'result', 'confirmed',
    'targetPointId', v_new_point_id,
    'sourceThreadId', v_pending.source_thread_id,
    'canonicalSubjectId', v_canonical_subject_id,
    'label', v_label,
    'evidenceProposalIds', v_evidence_ids,
    'memberId', v_new_member_id,
    'pointCreated', true,
    'membershipInserted', true
  );
END;
$$;

COMMENT ON FUNCTION public.confirm_pending_trackability(UUID) IS
  'Phase 6E.3B.2 — pilote réel : confirme UNE pending trace TRACKABILITY_UNDETERMINED (evidence déjà figée par 394) en un nouveau tracked_point PROVISIONAL/founding_kind=manual + UNE membership HARD scope=proposal_set (jamais thread, jamais un scope dynamique). L''humain affirme l''existence d''une condition durable, jamais son état — derivedState reste entièrement produit par le réducteur. Revalidation live complète (kind, status, evidence figée, non-collision, cross-site) ; idempotent sur rejeu identique via founding_source dédié ; RESOLUTION_WITHOUT_KNOWN_PROBLEM explicitement hors périmètre (ne fonde jamais son propre Point). Pilote HARD STOP : une seule pending trace par appel, aucun traitement en masse.';
