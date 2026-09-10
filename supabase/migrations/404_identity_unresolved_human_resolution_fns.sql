-- Migration 404 : fermeture humaine de IDENTITY_UNRESOLVED après rejet de tous les candidats
-- (mandat Vincent, suite de l'audit READ-ONLY "P6 — FERMER LE DERNIER BLOCKER
-- IDENTITY_UNRESOLVED").
--
-- Constat de l'audit (aucune écriture) : quand un humain rejette (rejectTraceIdentityCandidate)
-- le DERNIER tracked_point_identity_candidate pending d'un thread, la queue
-- (loadTraceIdentityQueue / buildTraceIdentityQueue, tracked-point-trace-queue.ts) ne montre
-- plus AUCUNE entrée pour ce thread : elle ne lit que status='pending' et le regroupement par
-- thread `continue`-ate silencieusement dès que targets.length===0. La tracked_point_pending_trace
-- kind='IDENTITY_UNRESOLVED' reste 'pending' en base mais devient invisible et bloquée — aucune
-- action existante ne permet d'associer le thread à un AUTRE Point que ceux déjà proposés, ni
-- de fonder un Point nouveau depuis cette trace précise. Décision Vincent : le besoin métier a
-- toujours deux sorties symétriques, jamais une seule — "aucun des Points proposés n'est le bon,
-- j'en choisis un autre existant" OU "c'est une situation réellement nouvelle, je crée un Point".
--
-- Cette migration ajoute deux primitives humaines, chacune démarrant DIRECTEMENT depuis la
-- pending trace IDENTITY_UNRESOLVED (jamais une reconstruction du pipeline historique, jamais un
-- nouveau moteur de matching, jamais un relance automatique) :
--
--   1. associate_identity_trace_to_point(p_pending_trace_id, p_target_point_id)
--      — associe le thread source à un Point EXISTANT librement désigné par l'humain (pas
--      nécessairement un candidat déjà proposé). Calquée sur associate_pending_resolution_to_point
--      (migration 396, NON modifiée — kind différent, guard 2 y reste RESOLUTION_WITHOUT_KNOWN_PROBLEM)
--      mais adaptée : pas d'evidence à figer pour ce kind (confirmé par grep de la migration 401 —
--      tracked_point_pending_trace_evidence n'est jamais peuplée pour IDENTITY_UNRESOLVED), donc
--      aucun guard EVIDENCE_*. La membership posée est scope='thread' / proposal_ids=NULL — même
--      grain que accept_trace_identity_candidate (393/402), car le seul site d'écriture réel de
--      tracked_point_identity_candidate (migration 401 ligne ~776) fige TOUJOURS scope='thread'
--      pour ce chemin : aucune ligne scope='proposal_set' n'existe en pratique ici.
--
--   2. create_point_from_identity_trace(p_pending_trace_id)
--      — fonde un Point NOUVEAU, PROVISIONAL, directement depuis la pending trace. Calquée sur
--      confirm_pending_trackability (migration 395) : founding_kind='manual', founding_reference
--      = pending_trace_id::text (convention Invariant 1, migration 400), derivedState entièrement
--      produit par le réducteur (jamais imposé ici). Différence avec 395 : aucune evidence figée
--      pour ce kind, donc le label est lu directement sur la proposition la plus récente du thread
--      source (document_extraction_proposal.subject_thread_id = source_thread_id), et la membership
--      posée est scope='thread' / proposal_ids=NULL (pas proposal_set — pas d'ensemble de preuve
--      figé à ce grain pour IDENTITY_UNRESOLVED). founding_source dédié
--      'human_created_from_identity_unresolved', distinct de celui de 395, pour que l'idempotence
--      ne confonde jamais les deux gestes.
--
-- Non-buts explicites (identiques à l'esprit de 395/396) : aucune reconstruction de la doctrine de
-- matching, aucun traitement en masse, aucune CBO inventée, aucun changement d'état métier (le
-- Point créé/rejoint est neutre — status='active'/identity_status='PROVISIONAL' pour la création,
-- aucune écriture sur le Point existant pour l'association hors la nouvelle membership).
--
-- Concurrence : verrouillage FOR UPDATE de la pending en premier, puis du target le cas échéant
-- (même ordre que 396, évite les deadlocks croisés avec accept_trace_identity_candidate qui
-- verrouille candidat puis target — ici il n'y a pas de candidat à verrouiller).
--
-- Migration écrite mais NON appliquée à ce lot (cf. mandat : OCEF non démarré, allowlist vide,
-- Live Writer OFF).

-- ============================================================================
-- 1. associate_identity_trace_to_point
-- ============================================================================
--
-- Checklist guard :
--   - pending introuvable                                 → guard 1
--   - kind ≠ IDENTITY_UNRESOLVED                           → guard 2 : INVALID_KIND
--   - status = 'dismissed'                                 → guard 3 : INVALID_STATUS
--   - status = 'resolved' vers un AUTRE target              → guard 4b : TARGET_MISMATCH
--   - status = 'resolved' vers CE MÊME target                → guard 4a : idempotence,
--     ALREADY_RESOLVED, 0 écriture (vérifie la membership HARD thread active)
--   - target introuvable                                   → guard 6 : INVALID_TARGET
--   - target.status = 'merged' (jamais suivre merged_into_id)
--                                                           → guard 7 : STALE_TARGET
--   - target.status ≠ 'active'                              → guard 8 : INVALID_TARGET
--   - target.identity_status = 'CONFLICTED'                  → guard 9 : TARGET_CONFLICTED
--   - cross-site (pending.site_id ≠ target.site_id), TOUJOURS → guard 10 : ABORT
--   - thread source déjà fondateur/membre HARD actif d'un AUTRE Point que la cible
--                                                           → guard 11 : STALE_ALREADY_CONSUMED
--   - membership HARD thread équivalente déjà active vers CETTE cible
--                                                           → guard 12 : idempotence,
--     ALREADY_ASSOCIATED, 0 nouvelle membership (finalise la pending)
CREATE OR REPLACE FUNCTION public.associate_identity_trace_to_point(
  p_pending_trace_id UUID,
  p_target_point_id UUID
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending            public.tracked_point_pending_trace%ROWTYPE;
  v_target             public.tracked_point%ROWTYPE;
  v_existing_member_id UUID;
  v_other_member_id    UUID;
  v_new_member_id      UUID;
BEGIN
  -- 1. Charger + verrouiller le pending
  SELECT * INTO v_pending FROM public.tracked_point_pending_trace WHERE id = p_pending_trace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'associate_identity_trace_to_point: pending trace introuvable (%)', p_pending_trace_id;
  END IF;

  -- 2. INVALID_KIND — seule IDENTITY_UNRESOLVED peut être associée ici
  IF v_pending.kind <> 'IDENTITY_UNRESOLVED' THEN
    RAISE EXCEPTION 'associate_identity_trace_to_point: INVALID_KIND — pending trace (%) kind=% (attendu IDENTITY_UNRESOLVED)',
      p_pending_trace_id, v_pending.kind;
  END IF;

  -- 3. INVALID_STATUS — dismissed n'est jamais reconfirmable
  IF v_pending.status = 'dismissed' THEN
    RAISE EXCEPTION 'associate_identity_trace_to_point: INVALID_STATUS — pending trace (%) status=dismissed, jamais reconfirmable', p_pending_trace_id;
  END IF;

  -- 4. Idempotence explicite si déjà resolved.
  IF v_pending.status = 'resolved' THEN
    -- 4b. TARGET_MISMATCH — jamais une réassignation silencieuse vers une autre cible.
    IF v_pending.target_point_id <> p_target_point_id THEN
      RAISE EXCEPTION 'associate_identity_trace_to_point: TARGET_MISMATCH — pending trace (%) déjà resolved vers target=% (demandé target=%) ; une correction de cible est une opération explicite séparée, jamais un second appel',
        p_pending_trace_id, v_pending.target_point_id, p_target_point_id;
    END IF;

    -- 4a. ALREADY_RESOLVED — même cible, vérifie l'invariant plutôt qu'un no-op silencieux.
    SELECT id INTO v_existing_member_id
    FROM public.tracked_point_member
    WHERE tracked_point_id = v_pending.target_point_id
      AND subject_thread_id = v_pending.source_thread_id
      AND scope = 'thread'
      AND status = 'active'
    LIMIT 1;

    IF v_existing_member_id IS NULL THEN
      RAISE EXCEPTION 'associate_identity_trace_to_point: pending trace (%) resolved vers Point (%) mais aucune membership HARD thread active correspondante (invariant rompu)',
        p_pending_trace_id, v_pending.target_point_id;
    END IF;

    RETURN jsonb_build_object(
      'pendingTraceId', p_pending_trace_id,
      'result', 'already_resolved',
      'targetPointId', v_pending.target_point_id,
      'sourceThreadId', v_pending.source_thread_id,
      'memberId', v_existing_member_id,
      'membershipInserted', false
    );
  END IF;

  -- 5. Défensif : seul 'pending' doit subsister ici (CHECK mig 390 exclut toute autre valeur)
  IF v_pending.status <> 'pending' THEN
    RAISE EXCEPTION 'associate_identity_trace_to_point: INVALID_STATUS — pending trace (%) status=% (attendu pending)', p_pending_trace_id, v_pending.status;
  END IF;

  -- 6. Charger + verrouiller la cible LITTÉRALE (jamais résolue via merged_into_id)
  SELECT * INTO v_target FROM public.tracked_point WHERE id = p_target_point_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'associate_identity_trace_to_point: INVALID_TARGET — target introuvable (%)', p_target_point_id;
  END IF;

  -- 7. STALE_TARGET — merged jamais suivi silencieusement
  IF v_target.status = 'merged' THEN
    RAISE EXCEPTION 'associate_identity_trace_to_point: STALE_TARGET — target (%) status=merged (vers %), jamais suivi automatiquement', p_target_point_id, v_target.merged_into_id;
  END IF;

  -- 8. INVALID_TARGET — retired (seule autre valeur possible que active/merged)
  IF v_target.status <> 'active' THEN
    RAISE EXCEPTION 'associate_identity_trace_to_point: INVALID_TARGET — target (%) status=% (attendu active)', p_target_point_id, v_target.status;
  END IF;

  -- 9. TARGET_CONFLICTED
  IF v_target.identity_status = 'CONFLICTED' THEN
    RAISE EXCEPTION 'associate_identity_trace_to_point: TARGET_CONFLICTED — target (%) identity_status=CONFLICTED, association humaine interdite', p_target_point_id;
  END IF;

  -- 10. ABORT — cross-site, toujours
  IF v_pending.site_id <> v_target.site_id THEN
    RAISE EXCEPTION 'associate_identity_trace_to_point: ABORT — pending site_id=% différent du target site_id=%', v_pending.site_id, v_target.site_id;
  END IF;

  -- 11. STALE_ALREADY_CONSUMED — le thread source ne doit pas être déjà fondateur/membre HARD
  -- actif d'un AUTRE Point que la cible (même mécanisme que accept_trace_identity_candidate
  -- guard 8, migration 402).
  SELECT tpm.id INTO v_other_member_id
  FROM public.tracked_point_member tpm
  WHERE tpm.subject_thread_id = v_pending.source_thread_id
    AND tpm.status = 'active'
    AND tpm.tracked_point_id <> p_target_point_id
  LIMIT 1;

  IF v_other_member_id IS NOT NULL THEN
    RAISE EXCEPTION 'associate_identity_trace_to_point: STALE_ALREADY_CONSUMED — thread source (%) déjà membre HARD actif (%) d''un Point différent de la cible demandée (%)',
      v_pending.source_thread_id, v_other_member_id, p_target_point_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tracked_point tp
    WHERE tp.founding_reference = v_pending.source_thread_id::text
      AND tp.id <> p_target_point_id
  ) THEN
    RAISE EXCEPTION 'associate_identity_trace_to_point: STALE_ALREADY_CONSUMED — thread source (%) déjà fondateur d''un Point différent de la cible demandée (%)',
      v_pending.source_thread_id, p_target_point_id;
  END IF;

  -- 12. ALREADY_ASSOCIATED — membership HARD thread équivalente déjà active vers CETTE cible
  -- précise (état incohérent avec pending encore 'pending', traité non-destructivement).
  SELECT id INTO v_existing_member_id
  FROM public.tracked_point_member
  WHERE tracked_point_id = p_target_point_id
    AND subject_thread_id = v_pending.source_thread_id
    AND scope = 'thread'
    AND status = 'active'
  LIMIT 1;

  IF v_existing_member_id IS NOT NULL THEN
    UPDATE public.tracked_point_pending_trace
    SET status = 'resolved', target_point_id = p_target_point_id, resolved_at = now()
    WHERE id = p_pending_trace_id;

    RETURN jsonb_build_object(
      'pendingTraceId', p_pending_trace_id,
      'result', 'already_associated',
      'targetPointId', p_target_point_id,
      'sourceThreadId', v_pending.source_thread_id,
      'memberId', v_existing_member_id,
      'membershipInserted', false
    );
  END IF;

  -- 13. Écriture atomique : +1 membership HARD scope=thread, pending → resolved.
  INSERT INTO public.tracked_point_member (
    tracked_point_id, subject_thread_id, scope, proposal_ids, status,
    resolution_source, evidence_grade
  ) VALUES (
    p_target_point_id, v_pending.source_thread_id, 'thread', NULL, 'active',
    'manual', 'HARD'
  ) RETURNING id INTO v_new_member_id;

  UPDATE public.tracked_point_pending_trace
  SET status = 'resolved', target_point_id = p_target_point_id, resolved_at = now()
  WHERE id = p_pending_trace_id;

  RETURN jsonb_build_object(
    'pendingTraceId', p_pending_trace_id,
    'result', 'associated',
    'targetPointId', p_target_point_id,
    'sourceThreadId', v_pending.source_thread_id,
    'memberId', v_new_member_id,
    'membershipInserted', true
  );
END;
$$;

COMMENT ON FUNCTION public.associate_identity_trace_to_point(UUID, UUID) IS
  'Fermeture humaine de IDENTITY_UNRESOLVED (sortie 1/2) : associe le thread source d''une pending trace IDENTITY_UNRESOLVED à un Point EXISTANT librement désigné par l''humain (pas nécessairement un candidat déjà proposé/rejeté), via UNE membership HARD scope=thread. Aucune evidence à figer pour ce kind (contrairement à associate_pending_resolution_to_point/396, RESOLUTION_WITHOUT_KNOWN_PROBLEM uniquement, non modifiée). Revalidation complète (kind, status, target actif/non-CONFLICTED/non-merged, cross-site toujours ABORT, non-collision) ; idempotent sur rejeu identique (ALREADY_RESOLVED / ALREADY_ASSOCIATED), TARGET_MISMATCH bruyant si rejeu avec une cible différente.';

-- ============================================================================
-- 2. create_point_from_identity_trace
-- ============================================================================
--
-- Checklist guard :
--   - pending introuvable                              → guard 1
--   - kind ≠ IDENTITY_UNRESOLVED                        → guard 2 : INVALID_KIND
--   - status = 'dismissed'                              → guard 3 : INVALID_STATUS
--   - status = 'resolved' déjà par CETTE fonction        → idempotence, ALREADY_RESOLVED,
--     (founding_source = 'human_created_from_identity_unresolved' du target)  0 écriture
--   - status = 'resolved' mais PAS par cette fonction    → guard 4 : INVALID_STATUS
--   - thread déjà fondateur/membre HARD d'un autre Point → guard 6 : STALE_ALREADY_TRACKED
--   - subject_thread_identity d'un autre site que le pending (cross-site défensif)
--                                                        → guard 7 : ABORT
--   - aucune proposition trouvée sur le thread source pour sourcer le label (NOT NULL)
--                                                        → guard 8 : LABEL_SOURCE_MISSING
CREATE OR REPLACE FUNCTION public.create_point_from_identity_trace(
  p_pending_trace_id UUID
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending              public.tracked_point_pending_trace%ROWTYPE;
  v_existing_point       public.tracked_point%ROWTYPE;
  v_existing_member_id   UUID;
  v_canonical_subject_id UUID;
  v_thread_site_id       UUID;
  v_label                TEXT;
  v_new_point_id         UUID;
  v_new_member_id        UUID;
BEGIN
  -- 1. Charger + verrouiller le pending
  SELECT * INTO v_pending FROM public.tracked_point_pending_trace WHERE id = p_pending_trace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_point_from_identity_trace: pending trace introuvable (%)', p_pending_trace_id;
  END IF;

  -- 2. INVALID_KIND — seule IDENTITY_UNRESOLVED peut fonder un Point ici
  IF v_pending.kind <> 'IDENTITY_UNRESOLVED' THEN
    RAISE EXCEPTION 'create_point_from_identity_trace: INVALID_KIND — pending trace (%) kind=% (attendu IDENTITY_UNRESOLVED)',
      p_pending_trace_id, v_pending.kind;
  END IF;

  -- 3. INVALID_STATUS — dismissed n'est jamais reconfirmable
  IF v_pending.status = 'dismissed' THEN
    RAISE EXCEPTION 'create_point_from_identity_trace: INVALID_STATUS — pending trace (%) status=dismissed, jamais reconfirmable', p_pending_trace_id;
  END IF;

  -- 4. Idempotence explicite si déjà resolved : doit être resolved PAR CETTE fonction
  -- (founding_source dédié) avec une membership HARD thread correspondante — sinon l'invariant
  -- est déjà rompu ailleurs, échec bruyant plutôt qu'un no-op silencieux.
  IF v_pending.status = 'resolved' THEN
    SELECT * INTO v_existing_point
    FROM public.tracked_point
    WHERE id = v_pending.target_point_id
      AND founding_kind = 'manual'
      AND founding_source = 'human_created_from_identity_unresolved'
      AND founding_reference = p_pending_trace_id::text;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_point_from_identity_trace: INVALID_STATUS — pending trace (%) déjà resolved (target=%) mais pas par create_point_from_identity_trace (invariant rompu)',
        p_pending_trace_id, v_pending.target_point_id;
    END IF;

    SELECT id INTO v_existing_member_id
    FROM public.tracked_point_member
    WHERE tracked_point_id = v_existing_point.id
      AND subject_thread_id = v_pending.source_thread_id
      AND scope = 'thread'
      AND status = 'active'
    LIMIT 1;

    IF v_existing_member_id IS NULL THEN
      RAISE EXCEPTION 'create_point_from_identity_trace: pending trace (%) resolved vers Point (%) mais aucune membership HARD thread active correspondante (invariant rompu)',
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
    RAISE EXCEPTION 'create_point_from_identity_trace: INVALID_STATUS — pending trace (%) status=% (attendu pending)', p_pending_trace_id, v_pending.status;
  END IF;

  -- 6. STALE_ALREADY_TRACKED — le thread source ne doit être ni fondateur ni membre HARD
  -- d'aucun Point (même mécanisme que confirm_pending_trackability guard 8, migration 395).
  IF EXISTS (
    SELECT 1 FROM public.tracked_point tp
    WHERE tp.site_id = v_pending.site_id AND tp.founding_reference = v_pending.source_thread_id::text
  ) OR EXISTS (
    SELECT 1 FROM public.tracked_point_member tpm
    WHERE tpm.subject_thread_id = v_pending.source_thread_id AND tpm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'create_point_from_identity_trace: STALE_ALREADY_TRACKED — thread source (%) déjà fondateur/membre HARD d''un Point depuis la création de la pending trace (%)',
      v_pending.source_thread_id, p_pending_trace_id;
  END IF;

  -- 7. ABORT — cross-site défensif (subject_thread_identity d'un autre site que le pending)
  SELECT site_id, canonical_subject_id INTO v_thread_site_id, v_canonical_subject_id
  FROM public.subject_thread_identity WHERE subject_thread_id = v_pending.source_thread_id;

  IF v_thread_site_id IS NOT NULL AND v_thread_site_id <> v_pending.site_id THEN
    RAISE EXCEPTION 'create_point_from_identity_trace: ABORT — subject_thread_identity du thread (%) site_id=% différent du pending site_id=%',
      v_pending.source_thread_id, v_thread_site_id, v_pending.site_id;
  END IF;

  -- 8. Label déterministe : proposition la plus récente directement sur le thread source (aucune
  -- evidence figée pour ce kind, contrairement à confirm_pending_trackability/395). tracked_point.label
  -- est NOT NULL (migration 388) : si aucune proposition n'existe sur ce thread, échec bruyant
  -- plutôt qu'un label inventé.
  SELECT label INTO v_label
  FROM public.document_extraction_proposal
  WHERE subject_thread_id = v_pending.source_thread_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_label IS NULL THEN
    RAISE EXCEPTION 'create_point_from_identity_trace: LABEL_SOURCE_MISSING — aucune document_extraction_proposal trouvée sur le thread source (%) de la pending trace (%), impossible de sourcer le label requis (tracked_point.label NOT NULL)',
      v_pending.source_thread_id, p_pending_trace_id;
  END IF;

  -- 9. Écriture atomique : +1 Point PROVISIONAL/manual, +1 membership HARD scope=thread,
  -- pending → resolved.
  INSERT INTO public.tracked_point (
    site_id, canonical_subject_id, label, status, identity_status,
    seed_source, founding_kind, founding_source, founding_reference, has_upstream_defect
  ) VALUES (
    v_pending.site_id, v_canonical_subject_id, v_label, 'active', 'PROVISIONAL',
    'manual', 'manual', 'human_created_from_identity_unresolved', p_pending_trace_id::text, false
  ) RETURNING id INTO v_new_point_id;

  INSERT INTO public.tracked_point_member (
    tracked_point_id, subject_thread_id, scope, proposal_ids, status,
    resolution_source, evidence_grade
  ) VALUES (
    v_new_point_id, v_pending.source_thread_id, 'thread', NULL, 'active',
    'manual', 'HARD'
  ) RETURNING id INTO v_new_member_id;

  UPDATE public.tracked_point_pending_trace
  SET status = 'resolved', target_point_id = v_new_point_id, resolved_at = now()
  WHERE id = p_pending_trace_id;

  RETURN jsonb_build_object(
    'pendingTraceId', p_pending_trace_id,
    'result', 'created',
    'targetPointId', v_new_point_id,
    'sourceThreadId', v_pending.source_thread_id,
    'canonicalSubjectId', v_canonical_subject_id,
    'label', v_label,
    'memberId', v_new_member_id,
    'pointCreated', true,
    'membershipInserted', true
  );
END;
$$;

COMMENT ON FUNCTION public.create_point_from_identity_trace(UUID) IS
  'Fermeture humaine de IDENTITY_UNRESOLVED (sortie 2/2) : fonde UN nouveau tracked_point PROVISIONAL/founding_kind=manual/founding_source=human_created_from_identity_unresolved + UNE membership HARD scope=thread, directement depuis la pending trace (jamais une reconstruction du pipeline historique). Label sourcé sur la proposition la plus récente du thread source (aucune evidence figée pour ce kind, contrairement à confirm_pending_trackability/395) ; LABEL_SOURCE_MISSING si aucune proposition n''existe. Revalidation live complète (kind, status, non-collision, cross-site) ; idempotent sur rejeu identique via founding_source dédié.';
