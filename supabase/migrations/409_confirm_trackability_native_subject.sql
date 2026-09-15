-- Migration 409 : confirm_pending_trackability conserve l'identité canonique native
-- (P0-1A-2a.1)
--
-- Décision explicite de Vincent (2026-09-15), verbatim : un Point créé par confirmation
-- d'une pending trace 100% native ne doit jamais rester avec canonical_subject_id NULL —
-- ce serait recréer une nouvelle forme d'orphelinage, exactement ce que la mémoire
-- longitudinale native est censée éviter. L'information canonique existe déjà avant la
-- confirmation (la migration 408 valide chaque preuve native en comparant la racine du
-- canonical_subject à source_thread_id) ; elle n'était simplement pas réinjectée dans le
-- Point créé.
--
-- Doctrine (verbatim Vincent) :
--   - historique : comportement actuel inchangé, dérivation exclusivement via
--     subject_thread_identity (guard 10, non touché) ;
--   - natif : résoudre canonical_subject_id depuis la famille native déjà validée par la
--     trace/evidence (guard EVIDENCE_SCOPE_INVALID existant), en suivant la racine
--     merged_into — jamais le sujet brut (pré-fusion) référencé par une proposition ;
--   - jamais choisir entre plusieurs sujets : le guard EVIDENCE_SCOPE_INVALID de la
--     migration 408 exige déjà que TOUTE l'evidence native validée résolve exactement à
--     v_pending.source_thread_id — il n'y a donc jamais de choix à faire, seulement une
--     valeur déjà unique à réutiliser ;
--   - confirmation native réussie → Point PROVISIONAL avec son canonical_subject_id ;
--   - replay idempotent : la branche "already_resolved" (étape 4, migration 395/408, non
--     touchée) ne recalcule jamais canonical_subject_id, aucun risque de divergence ;
--   - aucun impact sur les confirmations historiques : la dérivation native n'intervient
--     que si la recherche historique (subject_thread_identity) n'a rien renseigné.
--
-- 408 est déjà appliquée : migration additive, CREATE OR REPLACE sur la même signature
-- (aucun paramètre ajouté), pas de DROP nécessaire.

CREATE OR REPLACE FUNCTION public.confirm_pending_trackability(
  p_pending_trace_id UUID
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending               public.tracked_point_pending_trace%ROWTYPE;
  v_existing_point        public.tracked_point%ROWTYPE;
  v_existing_member_id    UUID;
  v_hist_evidence_ids     UUID[];
  v_native_evidence_ids   UUID[];
  v_hist_thread_hits      INT;
  v_native_thread_hits    INT;
  v_combined_evidence_ids UUID[];
  v_canonical_subject_id  UUID;
  v_thread_site_id        UUID;
  v_label                 TEXT;
  v_new_point_id          UUID;
  v_new_member_id         UUID;
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

  -- 6. EVIDENCE_SCOPE_UNRESOLVED — la portée de preuve doit avoir été figée par 394/408
  IF v_pending.evidence_status <> 'resolved' THEN
    RAISE EXCEPTION 'confirm_pending_trackability: EVIDENCE_SCOPE_UNRESOLVED — pending trace (%) evidence_status=% (attendu resolved via resolve_pending_trace_evidence)',
      p_pending_trace_id, v_pending.evidence_status;
  END IF;

  -- 7. EVIDENCE_MISSING — défensif, dual-famille (394/408 garantit resolved ⟺ ≥1 ligne,
  -- toutes familles confondues).
  SELECT COALESCE(array_agg(proposal_id ORDER BY proposal_id), ARRAY[]::UUID[]) INTO v_hist_evidence_ids
  FROM public.tracked_point_pending_trace_evidence
  WHERE pending_trace_id = p_pending_trace_id AND proposal_id IS NOT NULL;

  SELECT COALESCE(array_agg(native_proposal_id ORDER BY native_proposal_id), ARRAY[]::UUID[]) INTO v_native_evidence_ids
  FROM public.tracked_point_pending_trace_evidence
  WHERE pending_trace_id = p_pending_trace_id AND native_proposal_id IS NOT NULL;

  IF cardinality(v_hist_evidence_ids) = 0 AND cardinality(v_native_evidence_ids) = 0 THEN
    RAISE EXCEPTION 'confirm_pending_trackability: EVIDENCE_MISSING — pending trace (%) evidence_status=resolved mais 0 ligne d''evidence (invariant rompu)', p_pending_trace_id;
  END IF;

  -- 8. EVIDENCE_SCOPE_INVALID — revalidation défensive à la confirmation, chaque famille
  -- contre sa propre source de vérité (394 garde déjà l'écriture, ceci couvre un
  -- éventuel drift entretemps). Native : comparaison à la racine canonical_subject,
  -- jamais via subject_thread_identity.
  SELECT count(*) INTO v_hist_thread_hits
  FROM public.document_extraction_proposal
  WHERE id = ANY(v_hist_evidence_ids) AND subject_thread_id = v_pending.source_thread_id;

  IF v_hist_thread_hits <> cardinality(v_hist_evidence_ids) THEN
    RAISE EXCEPTION 'confirm_pending_trackability: EVIDENCE_SCOPE_INVALID — % proposition(s) historique(s) figée(s) sur % n''appartiennent plus au thread source (%) de la pending trace (%)',
      (cardinality(v_hist_evidence_ids) - v_hist_thread_hits), cardinality(v_hist_evidence_ids), v_pending.source_thread_id, p_pending_trace_id;
  END IF;

  SELECT count(*) INTO v_native_thread_hits
  FROM public.site_knowledge_proposals
  WHERE id = ANY(v_native_evidence_ids)
    AND public.canonical_subject_resolve_root(canonical_subject_id) = v_pending.source_thread_id;

  IF v_native_thread_hits <> cardinality(v_native_evidence_ids) THEN
    RAISE EXCEPTION 'confirm_pending_trackability: EVIDENCE_SCOPE_INVALID — % proposition(s) native(s) figée(s) sur % n''appartiennent plus au thread source (%) de la pending trace (%)',
      (cardinality(v_native_evidence_ids) - v_native_thread_hits), cardinality(v_native_evidence_ids), v_pending.source_thread_id, p_pending_trace_id;
  END IF;

  v_combined_evidence_ids := v_hist_evidence_ids || v_native_evidence_ids;

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

  -- 10. ABORT — cross-site défensif (subject_thread_identity d'un autre site que le pending ;
  -- famille historique uniquement, cf. doctrine en tête de la migration 408). C'est aussi
  -- l'unique source de canonical_subject_id pour la famille historique — inchangée.
  SELECT site_id, canonical_subject_id INTO v_thread_site_id, v_canonical_subject_id
  FROM public.subject_thread_identity WHERE subject_thread_id = v_pending.source_thread_id;

  IF v_thread_site_id IS NOT NULL AND v_thread_site_id <> v_pending.site_id THEN
    RAISE EXCEPTION 'confirm_pending_trackability: ABORT — subject_thread_identity du thread (%) site_id=% différent du pending site_id=%',
      v_pending.source_thread_id, v_thread_site_id, v_pending.site_id;
  END IF;

  -- 10bis. Dérivation canonical_subject_id — famille native (P0-1A-2a.1). Ne s'applique
  -- que si la recherche historique ci-dessus n'a rien renseigné : ne touche jamais une
  -- confirmation historique déjà couverte par subject_thread_identity. Pour la famille
  -- native, source_thread_id EST déjà la racine canonical_subject (convention P0-1A-1,
  -- cf. tête de la migration 408) — le guard EVIDENCE_SCOPE_INVALID (étape 8 ci-dessus)
  -- a déjà vérifié que TOUTE l'evidence native validée y résout exactement : aucune
  -- ambiguïté, jamais de choix entre plusieurs sujets, seulement une valeur déjà unique.
  IF v_canonical_subject_id IS NULL AND cardinality(v_native_evidence_ids) > 0 THEN
    v_canonical_subject_id := v_pending.source_thread_id;
  END IF;

  -- 11. Label déterministe : proposition la plus récente parmi l'evidence figée, toutes
  -- familles confondues (UNION ALL — document_extraction_proposal.label /
  -- site_knowledge_proposals.title, seul nom de colonne différent entre les deux tables).
  SELECT label INTO v_label FROM (
    SELECT label, created_at FROM public.document_extraction_proposal WHERE id = ANY(v_hist_evidence_ids)
    UNION ALL
    SELECT title AS label, created_at FROM public.site_knowledge_proposals WHERE id = ANY(v_native_evidence_ids)
  ) merged_evidence
  ORDER BY created_at DESC
  LIMIT 1;

  -- 12. Écriture atomique : +1 Point PROVISIONAL/manual, +1 membership HARD proposal_set
  -- (proposal_ids = union des deux familles, colonne libre sans FK — cf. mig 388), pending
  -- → resolved.
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
    v_new_point_id, v_pending.source_thread_id, 'proposal_set', v_combined_evidence_ids, 'active',
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
    'evidenceProposalIds', v_combined_evidence_ids,
    'memberId', v_new_member_id,
    'pointCreated', true,
    'membershipInserted', true
  );
END;
$$;

COMMENT ON FUNCTION public.confirm_pending_trackability(UUID) IS
  'Phase 6E.3B.2 + P0-1A-2a + P0-1A-2a.1 — confirme UNE pending trace TRACKABILITY_UNDETERMINED (evidence déjà figée par 394/408, historique et/ou native) en un nouveau tracked_point PROVISIONAL/founding_kind=manual + UNE membership HARD scope=proposal_set (jamais thread, jamais un scope dynamique). canonical_subject_id dérivé via subject_thread_identity pour l''historique (inchangé), ou via la racine canonical_subject déjà validée par l''evidence pour le natif (P0-1A-2a.1, jamais de choix entre plusieurs sujets — l''unicité est garantie par le guard EVIDENCE_SCOPE_INVALID). L''humain affirme l''existence d''une condition durable, jamais son état — derivedState reste entièrement produit par le réducteur. Revalidation live complète par famille (kind, status, evidence figée, non-collision, cross-site) ; idempotent sur rejeu identique via founding_source dédié ; RESOLUTION_WITHOUT_KNOWN_PROBLEM explicitement hors périmètre (ne fonde jamais son propre Point). Pilote HARD STOP : une seule pending trace par appel, aucun traitement en masse.';
