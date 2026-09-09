-- Migration 400 : fn_reconcile_tracked_point_unit (P6 Live Writer — RPC unique d'écriture)
--
-- Implémente la machine à états §3 du design frozen
-- (docs/tracked-points/p6-live-writer-design.md) : reçoit UNE FoundingUnit déjà
-- classifiée côté TS (decideFoundingV2/buildFoundingUnits, lib/knowledge/
-- tracked-point-founding.ts) et déjà transformée en plan pur (planPointForUnit /
-- planPendingTraceForUnit, lib/knowledge/tracked-point-write-plan.ts) + fingerprint
-- (lib/knowledge/tracked-point-fingerprint.ts). Cette fonction ne classifie RIEN —
-- elle verrouille l'état live, le revérifie contre le plan proposé, et écrit
-- atomiquement selon les 7 gestes du §2.1.
--
-- NO GO APPLY — cette migration n'est pas appliquée par ce lot (mandat explicite).
-- Aucun des 16 témoins de la matrice §5 n'a pu être exécuté (pas d'accès DB dans
-- ce worktree/cette session) : ce qui suit est une implémentation STRUCTURELLE
-- fidèle au design, NON VÉRIFIÉE PAR L'EXÉCUTION. Voir le rapport HARD STOP pour
-- le détail des décisions d'implémentation qui vont au-delà du texte figé du
-- design (P6-A/§2.2 dit "aucune concurrence live" sans énumérer la checklist
-- exacte de détection ; §2.1 ne précise pas le geste exact quand une fondation
-- automatique est bloquée par une concurrence, ni le cas IGNORED_NOT_TRACKABLE
-- explicitement absent des 7 gestes).
--
-- ── Décisions d'implémentation prises dans ce lot (au-delà du texte figé) ──────
--
-- D1. Portée de "concurrence live" (P6-A, §2.2) : interprétée comme concurrence
--     AU GRAIN DU THREAD uniquement (membership HARD active déjà posée sur ce
--     thread vers un AUTRE Point, pending trace active sur ce thread, candidate
--     pending sur ce thread) — PAS un scan cross-thread via le moteur Phase 4
--     (lib/knowledge/tracked-point-membership-candidates.ts). Aucun des 16
--     témoins §5 n'exerce d'ambiguïté cross-thread via rail LLM ; le protocole de
--     verrouillage §2.8 opère au grain du domaine d'identité (site+thread), pas
--     au grain du corpus entier. Câbler le voisinage Phase 4 dans ce writer
--     serait une extension de périmètre séparée, non spécifiée par les 7 gestes
--     d'écriture du §2.1. À CONFIRMER par Vincent/ChatGPT avant tout GO APPLY.
--
-- D2. Point merged/CONFLICTED déjà lié (CBO.tracked_point_id ou founding_identity
--     déjà fondé) → NEEDS_HUMAN / CREATE_PENDING_TRACE avec 0 candidat proposé
--     (jamais le Point merged/CONFLICTED lui-même comme suggestion — cohérent
--     avec "P6 ne suit jamais merged_into_id automatiquement", §2.3, étendu par
--     analogie à ne jamais non plus le PROPOSER comme candidat).
--
-- D3. Fondation trackable_condition bloquée par concurrence thread-scoped (D1) :
--     si une pending trace active existe déjà sur ce thread → RÉUTILISÉE
--     (0 nouvelle ligne, idempotent, cohérent avec l'esprit "ne pas dupliquer une
--     question déjà posée") plutôt que d'écrire un doublon logique. Si le
--     conflit vient d'une membership HARD active vers un AUTRE Point (pas
--     d'ambiguïté formelle, mais un signal fort) → ce Point est proposé comme
--     UNIQUE candidat (CREATE_CANDIDATES) plutôt qu'un CREATE_PENDING_TRACE sec.
--     Ce sont des choix défendables mais NON DICTÉS mot pour mot par le design ;
--     aucun des 16 témoins ne couvre ce sous-cas précis (extension de P6-A).
--
-- D4. IGNORED_NOT_TRACKABLE (aucun PlannedPoint ni PlannedPendingTrace) : absent
--     des 7 gestes du §2.1. Mappé sur write_pattern='NOOP' (0 écriture métier,
--     seul reconcile_state/event tracés) — c'est la seule lecture cohérente avec
--     "NOOP = rejeu sans effet métier", étendue au cas "rien à faire dès le
--     premier appel". À CONFIRMER.
--
-- Verrouillage — ordre total §2.8 respecté : (1) domaine d'identité thread,
-- (2) unité, (3) CBO, (4) pending trace, (5) tracked_point(s) ordre UUID croissant,
-- (6) tracked_point_member, (7) tracked_point_identity_candidate(s) ordre UUID
-- croissant, (8) reconcile_state.

CREATE OR REPLACE FUNCTION public.fn_reconcile_tracked_point_unit(
  p_site_id UUID,
  p_unit_key TEXT,
  p_thread_id UUID,
  p_scope TEXT,
  p_input_snapshot JSONB,
  p_input_fingerprint TEXT,
  p_source_kind TEXT,
  p_source_ref_id UUID,
  p_planned_point JSONB DEFAULT NULL,
  p_planned_pending_trace JSONB DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prev_state           public.tracked_point_reconcile_state%ROWTYPE;
  v_target                public.tracked_point%ROWTYPE;
  v_cbo                   public.canonical_business_object%ROWTYPE;
  v_pending               public.tracked_point_pending_trace%ROWTYPE;
  v_member_id             UUID;
  v_new_point_id           UUID;
  v_sibling_ids           UUID[];
  v_candidate_point_ids    UUID[];
  v_new_candidate_ids     UUID[] := '{}';
  v_verdict               TEXT;
  v_write_pattern         TEXT;
  v_target_point_id       UUID;
  v_reconcile_event_id    UUID;
  v_replayed              BOOLEAN := false;
  v_noop_compatible       BOOLEAN;
  v_member_scope          TEXT;
  v_member_proposal_ids   UUID[];
  v_existing_pending_kind TEXT;
BEGIN
  -- Guard 1 : plan mutuellement exclusif (au plus un des deux plans non-null).
  IF p_planned_point IS NOT NULL AND p_planned_pending_trace IS NOT NULL THEN
    RAISE EXCEPTION 'fn_reconcile_tracked_point_unit: INVALID_PLAN — planned_point et planned_pending_trace fournis simultanément pour unit_key=%', p_unit_key;
  END IF;
  IF p_scope NOT IN ('thread', 'proposal_set') THEN
    RAISE EXCEPTION 'fn_reconcile_tracked_point_unit: INVALID_SCOPE — % (attendu thread ou proposal_set)', p_scope;
  END IF;

  -- ── 1. Verrou de domaine d'identité (§2.8) ────────────────────────────────
  PERFORM pg_advisory_xact_lock(hashtext('tracked_point_identity:' || p_site_id::text || ':thread:' || p_thread_id::text)::bigint);

  -- ── 2. Verrou d'unité (§2.8) ───────────────────────────────────────────────
  PERFORM pg_advisory_xact_lock(hashtext('tracked_point_unit:' || p_site_id::text || ':' || p_unit_key)::bigint);

  -- ── 3. Recharger reconcile_state sous verrou ligne (dernier niveau §2.8, lu tôt
  --      pour le court-circuit NOOP, ré-écrit en dernier) ─────────────────────
  SELECT * INTO v_prev_state
  FROM public.tracked_point_reconcile_state
  WHERE site_id = p_site_id AND unit_key = p_unit_key
  FOR UPDATE;

  -- ── 4. Court-circuit NOOP (§2.5) — jamais sur la seule égalité de fingerprint ──
  IF FOUND AND v_prev_state.input_fingerprint = p_input_fingerprint THEN
    v_noop_compatible := false;

    IF v_prev_state.write_pattern IN ('ATTACH_MEMBER', 'ENRICH_EXISTING_POINT') THEN
      SELECT * INTO v_target FROM public.tracked_point WHERE id = v_prev_state.target_point_id FOR UPDATE;
      IF FOUND AND v_target.status = 'active' AND v_target.identity_status <> 'CONFLICTED' THEN
        SELECT id INTO v_member_id FROM public.tracked_point_member
        WHERE tracked_point_id = v_target.id AND subject_thread_id = p_thread_id AND status = 'active'
        LIMIT 1;
        IF v_member_id IS NOT NULL THEN
          v_noop_compatible := true;
        END IF;
      END IF;

    ELSIF v_prev_state.write_pattern IN ('CREATE_POINT_WITH_MEMBERSHIP', 'CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK') THEN
      SELECT * INTO v_target FROM public.tracked_point WHERE id = v_prev_state.target_point_id FOR UPDATE;
      IF FOUND AND v_target.status = 'active' THEN
        v_noop_compatible := true;
      END IF;

    ELSIF v_prev_state.write_pattern IN ('CREATE_PENDING_TRACE', 'CREATE_CANDIDATES') THEN
      -- Encore NEEDS_HUMAN si la pending trace de ce thread (tous kinds confondus,
      -- l'unité peut couvrir plusieurs kinds à des tentatives différentes) est
      -- toujours 'pending' ET qu'aucune candidate rattachée n'a été acceptée.
      SELECT p.* INTO v_pending FROM public.tracked_point_pending_trace p
      WHERE p.source_thread_id = p_thread_id AND p.status = 'pending'
      ORDER BY p.created_at DESC LIMIT 1;
      IF FOUND THEN
        v_noop_compatible := NOT EXISTS (
          SELECT 1 FROM public.tracked_point_identity_candidate c
          WHERE c.subject_thread_id = p_thread_id AND c.status <> 'pending'
        );
      END IF;

    ELSIF v_prev_state.write_pattern = 'NOOP' THEN
      v_noop_compatible := true;
    END IF;

    IF v_noop_compatible THEN
      INSERT INTO public.tracked_point_reconcile_event (
        site_id, unit_key, input_fingerprint, input_snapshot, verdict, write_pattern,
        target_point_id, replayed, source_kind, source_ref_id
      ) VALUES (
        p_site_id, p_unit_key, p_input_fingerprint, p_input_snapshot, v_prev_state.verdict, 'NOOP',
        v_prev_state.target_point_id, true, p_source_kind, p_source_ref_id
      ) RETURNING id INTO v_reconcile_event_id;

      RETURN jsonb_build_object(
        'unitKey', p_unit_key, 'verdict', v_prev_state.verdict, 'writePattern', 'NOOP',
        'targetPointId', v_prev_state.target_point_id, 'replayed', true,
        'reconcileEventId', v_reconcile_event_id, 'artifactIds', '[]'::jsonb
      );
    END IF;
    -- Sinon : incompatible avec l'état live → revalidation complète ci-dessous,
    -- comme si le fingerprint différait (§2.5, witness 9).
  END IF;

  -- ── 5. Branche A — le plan fonde ou rejoint un Point ──────────────────────
  IF p_planned_point IS NOT NULL THEN
    v_member_scope := p_planned_point->'member'->>'scope';
    v_member_proposal_ids := CASE
      WHEN p_planned_point->'member'->'proposalIds' IS NULL OR p_planned_point->'member'->'proposalIds' = 'null'::jsonb THEN NULL
      ELSE ARRAY(SELECT jsonb_array_elements_text(p_planned_point->'member'->'proposalIds'))::UUID[]
    END;

    IF p_planned_point->>'foundingKind' = 'cbo' THEN
      -- 5a. CBO (verrou niveau 3, §2.8)
      SELECT * INTO v_cbo FROM public.canonical_business_object
      WHERE id = (p_planned_point->>'foundingReference')::UUID FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_reconcile_tracked_point_unit: CBO_NOT_FOUND — % (unit_key=%)', p_planned_point->>'foundingReference', p_unit_key;
      END IF;

      IF v_cbo.tracked_point_id IS NOT NULL THEN
        SELECT * INTO v_target FROM public.tracked_point WHERE id = v_cbo.tracked_point_id FOR UPDATE;
        IF v_target.status = 'merged' OR v_target.identity_status = 'CONFLICTED' THEN
          -- P6-B (§2.3) — jamais ATTACH_MEMBER sur merged/CONFLICTED (D2).
          v_verdict := 'NEEDS_HUMAN';
          v_write_pattern := 'CREATE_PENDING_TRACE';
          v_target_point_id := NULL;
        ELSE
          v_verdict := 'AUTO_LINKED';
          v_write_pattern := 'ATTACH_MEMBER';
          v_target_point_id := v_target.id;
        END IF;
      ELSE
        -- P6-C sens inverse : un sibling trackable_condition déjà fondé sur ce thread ?
        SELECT array_agg(DISTINCT tp.id ORDER BY tp.id) INTO v_sibling_ids
        FROM public.tracked_point_member tpm
        JOIN public.tracked_point tp ON tp.id = tpm.tracked_point_id
        WHERE tpm.subject_thread_id = p_thread_id AND tpm.status = 'active'
          AND tp.status = 'active' AND tp.identity_status <> 'CONFLICTED';

        IF array_length(v_sibling_ids, 1) = 1 THEN
          SELECT * INTO v_target FROM public.tracked_point WHERE id = v_sibling_ids[1] FOR UPDATE;
          v_verdict := 'AUTO_LINKED';
          v_write_pattern := 'ENRICH_EXISTING_POINT';
          v_target_point_id := v_target.id;
        ELSIF array_length(v_sibling_ids, 1) > 1 THEN
          v_verdict := 'NEEDS_HUMAN';
          v_write_pattern := 'CREATE_CANDIDATES';
          v_candidate_point_ids := v_sibling_ids;
          v_target_point_id := NULL;
        ELSE
          -- Défensif : la table ne doit jamais contenir un Point cbo-fondé sur ce
          -- CBO sans que cbo.tracked_point_id le reflète (invariant CREATE_POINT_
          -- WITH_MEMBERSHIP_AND_CBO_LINK = les 3 écritures ou aucune, §2.1).
          IF EXISTS (
            SELECT 1 FROM public.tracked_point
            WHERE site_id = p_site_id AND founding_kind = 'cbo' AND founding_reference = v_cbo.id::text
          ) THEN
            RAISE EXCEPTION 'fn_reconcile_tracked_point_unit: DRIFT_CBO_LINK_MISSING — un tracked_point fondé sur ce CBO (%) existe sans que canonical_business_object.tracked_point_id le référence', v_cbo.id;
          END IF;
          v_verdict := 'AUTO_CREATED';
          v_write_pattern := 'CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK';
        END IF;
      END IF;

    ELSE -- foundingKind = 'trackable_condition'
      SELECT * INTO v_target FROM public.tracked_point
      WHERE site_id = p_site_id AND founding_kind = 'trackable_condition' AND founding_reference = p_unit_key
      FOR UPDATE;

      IF FOUND THEN
        IF v_target.status = 'merged' OR v_target.identity_status = 'CONFLICTED' THEN
          v_verdict := 'NEEDS_HUMAN';
          v_write_pattern := 'CREATE_PENDING_TRACE';
          v_target_point_id := NULL;
        ELSE
          v_verdict := 'AUTO_LINKED';
          v_write_pattern := 'ATTACH_MEMBER';
          v_target_point_id := v_target.id;
        END IF;
      ELSE
        -- P6-A (§2.2) : concurrence live thread-scoped (D1).
        SELECT array_agg(DISTINCT tp.id ORDER BY tp.id) INTO v_sibling_ids
        FROM public.tracked_point_member tpm
        JOIN public.tracked_point tp ON tp.id = tpm.tracked_point_id
        WHERE tpm.subject_thread_id = p_thread_id AND tpm.status = 'active';

        SELECT p.* INTO v_pending FROM public.tracked_point_pending_trace p
        WHERE p.source_thread_id = p_thread_id AND p.status = 'pending'
        ORDER BY p.created_at ASC LIMIT 1;

        IF array_length(v_sibling_ids, 1) > 0 THEN
          -- Signal fort mais pas une ambiguïté formelle : jamais auto-attach sans
          -- confirmation (D3) — le(s) sibling(s) devient(nent) candidat(s).
          v_verdict := 'NEEDS_HUMAN';
          v_write_pattern := 'CREATE_CANDIDATES';
          v_candidate_point_ids := v_sibling_ids;
          v_target_point_id := NULL;
        ELSIF FOUND THEN
          -- Question déjà ouverte sur ce thread : ne pas la dupliquer (D3),
          -- réutiliser telle quelle.
          v_verdict := 'NEEDS_HUMAN';
          v_write_pattern := 'CREATE_PENDING_TRACE';
          v_target_point_id := NULL;
        ELSE
          v_verdict := 'AUTO_CREATED';
          v_write_pattern := 'CREATE_POINT_WITH_MEMBERSHIP';
        END IF;
      END IF;
    END IF;

  -- ── 6. Branche B — résolution/trackabilité en attente, aucun fondateur direct ──
  ELSIF p_planned_pending_trace IS NOT NULL THEN
    v_verdict := 'NEEDS_HUMAN';

    SELECT p.* INTO v_pending FROM public.tracked_point_pending_trace p
    WHERE p.source_thread_id = p_thread_id
      AND p.kind = (p_planned_pending_trace->>'kind')
      AND p.status = 'pending'
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.tracked_point_pending_trace (site_id, source_thread_id, kind, reason)
      VALUES (p_site_id, p_thread_id, p_planned_pending_trace->>'kind', p_planned_pending_trace->>'reason')
      RETURNING * INTO v_pending;
    END IF;

    -- Voisinage thread-scoped uniquement (D1, même portée que P6-A).
    SELECT array_agg(DISTINCT tp.id ORDER BY tp.id) INTO v_sibling_ids
    FROM public.tracked_point_member tpm
    JOIN public.tracked_point tp ON tp.id = tpm.tracked_point_id
    WHERE tpm.subject_thread_id = p_thread_id AND tpm.status = 'active'
      AND tp.status = 'active' AND tp.identity_status <> 'CONFLICTED';

    v_write_pattern := CASE WHEN array_length(v_sibling_ids, 1) > 0 THEN 'CREATE_CANDIDATES' ELSE 'CREATE_PENDING_TRACE' END;
    v_candidate_point_ids := v_sibling_ids;
    v_target_point_id := NULL;

  -- ── 7. Branche C — rien à fonder, rien à faire arbitrer (D4) ──────────────
  ELSE
    v_verdict := 'IGNORED_NOT_TRACKABLE';
    v_write_pattern := 'NOOP';
    v_target_point_id := NULL;
  END IF;

  -- ── 8. Écritures atomiques selon le geste retenu ──────────────────────────
  IF v_write_pattern = 'CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK' THEN
    INSERT INTO public.tracked_point (
      site_id, canonical_subject_id, label, status, seed_source,
      identity_status, founding_kind, founding_source, founding_reference, has_upstream_defect
    ) VALUES (
      p_site_id, NULLIF(p_planned_point->>'canonicalSubjectId', '')::UUID, p_planned_point->>'label', 'active', p_planned_point->>'seedSource',
      'CONFIRMED', 'cbo', p_planned_point->>'foundingSource', p_planned_point->>'foundingReference', (p_planned_point->>'hasUpstreamDefect')::BOOLEAN
    ) RETURNING id INTO v_new_point_id;

    INSERT INTO public.tracked_point_member (
      tracked_point_id, subject_thread_id, scope, proposal_ids, status, resolution_source, evidence_grade
    ) VALUES (
      v_new_point_id, p_thread_id, v_member_scope, v_member_proposal_ids, 'active', 'deterministic', 'HARD'
    ) RETURNING id INTO v_member_id;

    UPDATE public.canonical_business_object SET tracked_point_id = v_new_point_id
    WHERE id = (p_planned_point->>'foundingReference')::UUID;

    v_target_point_id := v_new_point_id;

  ELSIF v_write_pattern = 'CREATE_POINT_WITH_MEMBERSHIP' THEN
    INSERT INTO public.tracked_point (
      site_id, canonical_subject_id, label, status, seed_source,
      identity_status, founding_kind, founding_source, founding_reference, has_upstream_defect
    ) VALUES (
      p_site_id, NULLIF(p_planned_point->>'canonicalSubjectId', '')::UUID, p_planned_point->>'label', 'active', p_planned_point->>'seedSource',
      'PROVISIONAL', 'trackable_condition', p_planned_point->>'foundingSource', p_unit_key, (p_planned_point->>'hasUpstreamDefect')::BOOLEAN
    ) RETURNING id INTO v_new_point_id;

    INSERT INTO public.tracked_point_member (
      tracked_point_id, subject_thread_id, scope, proposal_ids, status, resolution_source, evidence_grade
    ) VALUES (
      v_new_point_id, p_thread_id, v_member_scope, v_member_proposal_ids, 'active', 'deterministic', 'HARD'
    ) RETURNING id INTO v_member_id;

    v_target_point_id := v_new_point_id;

  ELSIF v_write_pattern = 'ATTACH_MEMBER' THEN
    SELECT id INTO v_member_id FROM public.tracked_point_member
    WHERE tracked_point_id = v_target_point_id AND subject_thread_id = p_thread_id
      AND scope = v_member_scope
      AND (v_member_proposal_ids IS NULL OR proposal_ids = v_member_proposal_ids)
      AND status = 'active'
    LIMIT 1;

    IF v_member_id IS NULL THEN
      INSERT INTO public.tracked_point_member (
        tracked_point_id, subject_thread_id, scope, proposal_ids, status, resolution_source, evidence_grade
      ) VALUES (
        v_target_point_id, p_thread_id, v_member_scope, v_member_proposal_ids, 'active', 'deterministic', 'HARD'
      ) RETURNING id INTO v_member_id;
    ELSE
      v_member_id := NULL; -- déjà existante : rien de nouveau à tracer en artifact
    END IF;

  ELSIF v_write_pattern = 'ENRICH_EXISTING_POINT' THEN
    UPDATE public.canonical_business_object SET tracked_point_id = v_target_point_id
    WHERE id = (p_planned_point->>'foundingReference')::UUID AND tracked_point_id IS NULL;

  ELSIF v_write_pattern = 'CREATE_CANDIDATES' THEN
    IF v_candidate_point_ids IS NOT NULL THEN
      -- Verrou niveau 7, ordre UUID croissant (§2.8) — déjà garanti par array_agg ORDER BY.
      WITH to_insert AS (
        SELECT cid FROM unnest(v_candidate_point_ids) AS cid
        WHERE NOT EXISTS (
          SELECT 1 FROM public.tracked_point_identity_candidate c
          WHERE c.candidate_point_id = cid AND c.subject_thread_id = p_thread_id
            AND c.scope = 'thread' AND c.status = 'pending'
        )
      )
      INSERT INTO public.tracked_point_identity_candidate (site_id, candidate_point_id, subject_thread_id, scope, reason)
      SELECT p_site_id, cid, p_thread_id, 'thread', 'Point déjà rattaché à ce thread (membership HARD active) — cible plausible détectée par le Live Writer.'
      FROM to_insert
      RETURNING id INTO v_new_candidate_ids; -- dernier id seulement si plusieurs lignes ; agrégé juste après

      SELECT array_agg(c.id) INTO v_new_candidate_ids
      FROM public.tracked_point_identity_candidate c
      WHERE c.subject_thread_id = p_thread_id AND c.candidate_point_id = ANY(v_candidate_point_ids)
        AND c.status = 'pending' AND c.created_at >= now() - interval '1 second';
    END IF;
  END IF;

  -- ── 9. reconcile_state UPSERT + reconcile_event + reconcile_artifact (§2.6) ──
  INSERT INTO public.tracked_point_reconcile_state (site_id, unit_key, input_fingerprint, verdict, write_pattern, target_point_id, updated_at)
  VALUES (p_site_id, p_unit_key, p_input_fingerprint, v_verdict, v_write_pattern, v_target_point_id, now())
  ON CONFLICT (site_id, unit_key) DO UPDATE SET
    input_fingerprint = EXCLUDED.input_fingerprint,
    verdict = EXCLUDED.verdict,
    write_pattern = EXCLUDED.write_pattern,
    target_point_id = EXCLUDED.target_point_id,
    updated_at = now();

  INSERT INTO public.tracked_point_reconcile_event (
    site_id, unit_key, input_fingerprint, input_snapshot, verdict, write_pattern,
    target_point_id, replayed, source_kind, source_ref_id
  ) VALUES (
    p_site_id, p_unit_key, p_input_fingerprint, p_input_snapshot, v_verdict, v_write_pattern,
    v_target_point_id, false, p_source_kind, p_source_ref_id
  ) RETURNING id INTO v_reconcile_event_id;

  IF v_write_pattern IN ('CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK', 'CREATE_POINT_WITH_MEMBERSHIP') THEN
    INSERT INTO public.tracked_point_reconcile_artifact (reconcile_event_id, artifact_kind, artifact_id) VALUES (v_reconcile_event_id, 'tracked_point', v_new_point_id);
    INSERT INTO public.tracked_point_reconcile_artifact (reconcile_event_id, artifact_kind, artifact_id) VALUES (v_reconcile_event_id, 'tracked_point_member', v_member_id);
    IF v_write_pattern = 'CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK' THEN
      INSERT INTO public.tracked_point_reconcile_artifact (reconcile_event_id, artifact_kind, artifact_id) VALUES (v_reconcile_event_id, 'canonical_business_object', (p_planned_point->>'foundingReference')::UUID);
    END IF;
  ELSIF v_write_pattern = 'ATTACH_MEMBER' AND v_member_id IS NOT NULL THEN
    INSERT INTO public.tracked_point_reconcile_artifact (reconcile_event_id, artifact_kind, artifact_id) VALUES (v_reconcile_event_id, 'tracked_point_member', v_member_id);
  ELSIF v_write_pattern = 'ENRICH_EXISTING_POINT' THEN
    INSERT INTO public.tracked_point_reconcile_artifact (reconcile_event_id, artifact_kind, artifact_id) VALUES (v_reconcile_event_id, 'canonical_business_object', (p_planned_point->>'foundingReference')::UUID);
  ELSIF v_write_pattern IN ('CREATE_PENDING_TRACE', 'CREATE_CANDIDATES') THEN
    IF v_pending.id IS NOT NULL AND v_pending.created_at >= now() - interval '1 second' THEN
      INSERT INTO public.tracked_point_reconcile_artifact (reconcile_event_id, artifact_kind, artifact_id) VALUES (v_reconcile_event_id, 'tracked_point_pending_trace', v_pending.id);
    END IF;
    IF v_new_candidate_ids IS NOT NULL THEN
      INSERT INTO public.tracked_point_reconcile_artifact (reconcile_event_id, artifact_kind, artifact_id)
      SELECT v_reconcile_event_id, 'tracked_point_identity_candidate', cid FROM unnest(v_new_candidate_ids) AS cid;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'unitKey', p_unit_key,
    'verdict', v_verdict,
    'writePattern', v_write_pattern,
    'targetPointId', v_target_point_id,
    'replayed', false,
    'reconcileEventId', v_reconcile_event_id,
    'pendingTraceId', v_pending.id,
    'newCandidateIds', to_jsonb(COALESCE(v_new_candidate_ids, '{}'::UUID[]))
  );
END;
$$;

COMMENT ON FUNCTION public.fn_reconcile_tracked_point_unit(UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, UUID, JSONB, JSONB) IS
  'P6 Live Writer — RPC unique d''écriture pour UNE FoundingUnit déjà classifiée (decideFoundingV2) et déjà transformée en plan pur (planPointForUnit/planPendingTraceForUnit). Verrouille §2.8 (domaine identité thread puis unité), revalide contre l''état live avant toute conclusion NOOP (§2.5, jamais sur la seule égalité de fingerprint), exécute un des 7 gestes du §2.1. P6-B (merged/CONFLICTED ⇒ toujours NEEDS_HUMAN) et P6-C (founding_kind/founding_reference immuables, CBO tardif ⇒ ENRICH_EXISTING_POINT seul) appliqués sans exception. Décisions d''implémentation D1-D4 (portée de la détection de concurrence P6-A, traitement des candidats sur cible merged/CONFLICTED, réutilisation d''une pending trace déjà ouverte, mapping IGNORED_NOT_TRACKABLE→NOOP) documentées en tête de fichier — NON dictées mot pour mot par le design frozen, à confirmer avant GO APPLY. NON EXÉCUTÉ : aucun des 16 témoins de la matrice §5 n''a pu être lancé (pas d''accès DB dans ce lot).';
