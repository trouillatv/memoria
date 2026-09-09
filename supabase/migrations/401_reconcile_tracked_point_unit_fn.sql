-- Migration 401 : fn_reconcile_tracked_point_unit (P6 Live Writer — RPC unique d'écriture)
--
-- Renumérotée 400→401 (Round 2, cf. migration 400) — schéma en 400, fonction ici.
--
-- Implémente la machine à états §3 du design frozen
-- (docs/tracked-points/p6-live-writer-design.md) : reçoit UNE FoundingUnit déjà
-- classifiée côté TS (decideFoundingV2/buildFoundingUnits, lib/knowledge/
-- tracked-point-founding.ts) et déjà transformée en plan pur (planPointForUnit /
-- planPendingTraceForUnit, lib/knowledge/tracked-point-write-plan.ts) + fingerprint
-- (lib/knowledge/tracked-point-fingerprint.ts). Cette fonction ne classifie RIEN —
-- elle verrouille l'état live, le revérifie contre le plan proposé, et écrit
-- atomiquement selon un des 8 gestes du §2.1 (7 gestes figés + IGNORE_NOT_TRACKABLE,
-- décision D4 ci-dessous).
--
-- NO GO APPLY — cette migration n'est pas appliquée par ce lot (mandat explicite).
-- Aucun des 16 témoins de la matrice §5 n'a pu être exécuté (pas d'accès DB dans ce
-- worktree/cette session) : ce qui suit est une implémentation STRUCTURELLE fidèle
-- au design, NON VÉRIFIÉE PAR L'EXÉCUTION. Voir le rapport HARD STOP Round 2 pour le
-- détail.
--
-- ── Décisions d'implémentation D1-D4 — arbitrées par Vincent (Round 2), FIXÉES ──
--
-- D1. Portée de "concurrence live" (P6-A, §2.2) : une identité concurrente connue
--     CROSS-THREAD ne peut jamais être ignorée pour laisser P6 fonder un nouveau
--     Point. Le grain thread reste le signal PRIMAIRE (D3, prioritaire) ; à défaut
--     de sibling thread-scoped exploitable, le moteur de voisinage Phase 4
--     (lib/knowledge/tracked-point-membership-candidates.ts, evaluateMembershipCandidate,
--     rails cbo/exact/strong_containment/bounded_cross_subject — AUCUN rail llm câblé)
--     est réutilisé TEL QUEL côté TS (lib/knowledge/tracked-point-write-plan.ts,
--     crossThreadConcurrentPointIds) pour produire une liste de Points candidats,
--     transmise ici via p_cross_thread_candidate_point_ids. Ce n'est PAS un second
--     moteur de décision : cette fonction ne fait jamais confiance à la liste fournie
--     sans la revérifier live (status='active', identity_status<>'CONFLICTED') sous
--     verrou, exactement comme elle revérifie déjà les siblings thread-scoped.
--     Portée strictement limitée à l'autocréation PROVISIONAL (branche
--     founding_kind='trackable_condition' sans founder existant) — jamais étendue à la
--     branche CBO (identité déjà arbitrée en amont par canonical_business_object, signal
--     plus fort) ni à la Branche B (résolution en attente, qui ne fonde déjà jamais de
--     Point automatiquement).
--
-- D2. Point merged/CONFLICTED déjà lié (CBO.tracked_point_id ou founding_identity déjà
--     fondé) → NEEDS_HUMAN / CREATE_PENDING_TRACE avec 0 candidat proposé (jamais le
--     Point merged/CONFLICTED lui-même comme suggestion — cohérent avec "P6 ne suit
--     jamais merged_into_id automatiquement", §2.3, étendu par analogie à ne jamais non
--     plus le PROPOSER comme candidat). GO — inchangé depuis Round 1.
--
-- D3. Règle de décision unique, appliquée à CHAQUE tier de signal (thread-scoped
--     d'abord, cross-thread ensuite en repli — D1) : 0 cible compatible → éventuellement
--     AUTO_CREATE (si aucun repli plus faible n'en trouve une non plus) ; 1 cible
--     compatible unique → AUTO_LINK/ENRICH ; plus d'1 cible OU contradiction →
--     NEEDS_HUMAN. Un candidat cross-thread (signal fuzzy, D1) n'est JAMAIS auto-lié
--     même s'il est unique : il reste toujours au tier NEEDS_HUMAN/CREATE_CANDIDATES —
--     seul le signal thread-scoped exact (membership HARD déjà posée sur CE thread)
--     bénéficie de l'auto-link sur cible unique.
--
-- D4. IGNORED_NOT_TRACKABLE (aucun PlannedPoint ni PlannedPendingTrace) : 8e geste
--     explicite write_pattern='IGNORE_NOT_TRACKABLE' pour la PREMIÈRE tentative (0
--     écriture métier, seul reconcile_state/event tracés). Un rejeu compatible
--     (même fingerprint, toujours rien à fonder) retourne write_pattern='NOOP',
--     replayed=true — jamais 'IGNORE_NOT_TRACKABLE' réutilisé comme pattern de rejeu,
--     pour garder 'NOOP' comme unique sémantique "rejeu sans effet métier" (§2.5).
--
-- ── Corrections structurelles Round 2 (bloqueurs confirmés) ────────────────────
--
-- - Ordre de verrouillage §2.8 : l'étape 3 ne verrouille plus reconcile_state
--   (niveau 8) avant les niveaux 3-7 — lecture SANS FOR UPDATE pour le court-circuit
--   NOOP ; le seul verrou réel sur cette ligne reste l'UPSERT final (étape 9), qui
--   intervient déjà après tous les niveaux inférieurs dans l'ordre du programme.
--   Sans risque de double-écriture : le verrou avancé de niveau 2 (unit_key) sérialise
--   déjà tout appel concurrent sur la même unité avant que ce SELECT ne soit exécuté.
-- - CREATE_CANDIDATES : l'ancien `INSERT ... RETURNING id INTO v_new_candidate_ids`
--   (UUID scalaire dans une variable UUID[], invalide pour un INSERT multi-lignes) et
--   la reselection heuristique `created_at >= now() - interval '1 second'` sont
--   remplacés par un CTE `INSERT ... RETURNING id` agrégé via array_agg — capture
--   exacte de ce que CETTE tentative a inséré, aucune fenêtre temporelle.
-- - Artefact pending_trace (étape 9) : l'heuristique `created_at >= now() - interval
--   '1 second'` est remplacée par le booléen explicite v_pending_created, positionné
--   au seul point où l'INSERT a réellement lieu (Branche B).
-- - SECURITY DEFINER durci : `SET search_path = ''` (tous les objets déjà qualifiés
--   `public.`/`pg_catalog` implicite) + REVOKE PUBLIC/anon/authenticated + GRANT
--   EXECUTE service_role uniquement — cette fonction écrit de façon autonome, sans
--   confirmation humaine, ce n'est pas un raffinement de sécurité mais une frontière
--   de privilège.
-- - Forme de retour du court-circuit NOOP (étape 4) alignée sur la forme du retour
--   normal (pendingTraceId/newCandidateIds), qui est ce que le wrapper TS
--   (lib/db/tracked-point-live-writer.ts) lit réellement — l'ancienne forme
--   ('artifactIds') ne correspondait à aucun champ consommé.
-- - Failpoint witness 14 : AUCUN paramètre RPC caché. La fonction consulte le GUC de
--   session `p6_test.fail_after_point_insert` (current_setting(..., missing_ok=true),
--   inerte par construction — PostgREST n'expose aucun mécanisme pour qu'un appelant
--   fixe un GUC arbitraire) immédiatement après chaque INSERT tracked_point. Seule une
--   fonction harness séparée, hors supabase/migrations/ (supabase/testing/
--   p6_test_failpoint_harness.sql), positionne ce GUC — appliquée uniquement sur une
--   base jetable, jamais sur la cible réelle.
--
-- Verrouillage — ordre total §2.8 respecté : (1) domaine d'identité thread,
-- (2) unité, (3) CBO, (4) pending trace, (5) tracked_point(s) ordre UUID croissant,
-- (6) tracked_point_member, (7) tracked_point_identity_candidate(s) ordre UUID
-- croissant, (8) reconcile_state (verrouillé en dernier, à l'UPSERT final).

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
  p_planned_pending_trace JSONB DEFAULT NULL,
  p_cross_thread_candidate_point_ids UUID[] DEFAULT '{}'::UUID[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prev_state           public.tracked_point_reconcile_state%ROWTYPE;
  v_target                public.tracked_point%ROWTYPE;
  v_cbo                   public.canonical_business_object%ROWTYPE;
  v_pending               public.tracked_point_pending_trace%ROWTYPE;
  v_pending_created       BOOLEAN := false;
  v_member_id             UUID;
  v_new_point_id           UUID;
  v_sibling_ids           UUID[];
  v_cross_thread_ids      UUID[];
  v_candidate_point_ids    UUID[];
  v_candidate_reason      TEXT;
  v_new_candidate_ids     UUID[];
  v_verdict               TEXT;
  v_write_pattern         TEXT;
  v_target_point_id       UUID;
  v_reconcile_event_id    UUID;
  v_replayed              BOOLEAN := false;
  v_noop_compatible       BOOLEAN;
  v_member_scope          TEXT;
  v_member_proposal_ids   UUID[];
  v_existing_pending_kind TEXT;
  v_accepted_target_id    UUID;
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

  -- ── 2. Verrou d'unité (§2.8) — sérialise déjà tout appel concurrent sur ce
  --      unit_key avant l'étape 3 : aucun verrou de ligne supplémentaire n'est requis
  --      pour lire reconcile_state en sécurité ci-dessous. ────────────────────────
  PERFORM pg_advisory_xact_lock(hashtext('tracked_point_unit:' || p_site_id::text || ':' || p_unit_key)::bigint);

  -- ── 3. Lire reconcile_state (SANS verrou de ligne — §2.8 : le niveau 8 n'est
  --      verrouillé qu'à l'UPSERT final, étape 9, pour respecter l'ordre total même
  --      quand ce court-circuit échoue et que les niveaux 3-7 sont ensuite acquis) ──
  SELECT * INTO v_prev_state
  FROM public.tracked_point_reconcile_state
  WHERE site_id = p_site_id AND unit_key = p_unit_key;

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

    ELSIF v_prev_state.write_pattern IN ('NOOP', 'IGNORE_NOT_TRACKABLE') THEN
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
        'reconcileEventId', v_reconcile_event_id,
        'pendingTraceId', v_pending.id,
        'newCandidateIds', '[]'::jsonb
      );
    END IF;
    -- Sinon : incompatible avec l'état live → revalidation complète ci-dessous,
    -- comme si le fingerprint différait (§2.5, witness 9).
  END IF;

  -- Repartir d'un état vierge pour la revalidation complète (v_pending a pu être
  -- chargé par le court-circuit ci-dessus sans qu'aucune écriture n'ait eu lieu).
  v_pending := NULL;

  -- Round 3 (Vincent, témoin 13) : une acceptation humaine terminale déjà posée sur ce
  -- thread (accept_trace_identity_candidate, scope='thread', migration 393) reste
  -- décisive quel que soit le tier de signal ci-dessous — sans ce pré-calcul, un thread
  -- multi-sibling redemande indéfiniment un arbitrage déjà tranché à chaque nouvelle
  -- unité rencontrée sur ce thread ("hors périmètre" rejeté par Vincent). Simple lecture
  -- ici (pas de FOR UPDATE : le candidat lui-même n'est jamais écrit par cette fonction) —
  -- chaque branche revérifie la cible sous verrou avant de s'en servir. En cas
  -- d'acceptations multiples concurrentes vers des cibles différentes (état incohérent
  -- que cette fonction n'a pas vocation à arbitrer), la plus récente l'emporte.
  SELECT c.candidate_point_id INTO v_accepted_target_id
  FROM public.tracked_point_identity_candidate c
  JOIN public.tracked_point tp ON tp.id = c.candidate_point_id
  WHERE c.subject_thread_id = p_thread_id AND c.scope = 'thread' AND c.status = 'accepted'
    AND tp.status = 'active' AND tp.identity_status <> 'CONFLICTED'
  ORDER BY c.resolved_at DESC NULLS LAST, c.created_at DESC
  LIMIT 1;

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
        -- Round 3 (Vincent, témoin 13) : une acceptation humaine terminale déjà posée sur
        -- ce thread prime sur le recalcul de voisinage ci-dessous — revérifiée sous verrou
        -- (v_accepted_target_id a pu devenir invalide depuis le pré-calcul non verrouillé).
        IF v_accepted_target_id IS NOT NULL THEN
          SELECT * INTO v_target FROM public.tracked_point WHERE id = v_accepted_target_id FOR UPDATE;
          IF NOT FOUND OR v_target.status <> 'active' OR v_target.identity_status = 'CONFLICTED' THEN
            v_accepted_target_id := NULL;
          END IF;
        END IF;

        IF v_accepted_target_id IS NOT NULL THEN
          v_verdict := 'AUTO_LINKED';
          v_write_pattern := 'ENRICH_EXISTING_POINT';
          v_target_point_id := v_target.id;

        ELSE
          -- P6-C sens inverse (D3, signal thread-scoped exact — identité CBO déjà
          -- arbitrée en amont, D1 non étendu ici, cf. tête de fichier) : un sibling
          -- trackable_condition déjà fondé sur ce thread ? Verrou pris DANS la
          -- sous-requête (BUG 3a, Round 3) : array_agg ne peut pas se combiner à FOR
          -- UPDATE au même niveau, d'où le filtrage status/identity_status après verrou.
          SELECT array_agg(sub.id ORDER BY sub.id) INTO v_sibling_ids
          FROM (
            SELECT tp.id, tp.status, tp.identity_status
            FROM public.tracked_point_member tpm
            JOIN public.tracked_point tp ON tp.id = tpm.tracked_point_id
            WHERE tpm.subject_thread_id = p_thread_id AND tpm.status = 'active'
            ORDER BY tp.id
            FOR UPDATE OF tp
          ) sub
          WHERE sub.status = 'active' AND sub.identity_status <> 'CONFLICTED';

          IF array_length(v_sibling_ids, 1) = 1 THEN
            -- Déjà verrouillée par la sous-requête ci-dessus : pas de second FOR UPDATE.
            SELECT * INTO v_target FROM public.tracked_point WHERE id = v_sibling_ids[1];
            v_verdict := 'AUTO_LINKED';
            v_write_pattern := 'ENRICH_EXISTING_POINT';
            v_target_point_id := v_target.id;
          ELSIF array_length(v_sibling_ids, 1) > 1 THEN
            v_verdict := 'NEEDS_HUMAN';
            v_write_pattern := 'CREATE_CANDIDATES';
            v_candidate_point_ids := v_sibling_ids;
            v_candidate_reason := 'Plusieurs Points déjà rattachés à ce thread (membership HARD active) — impossible de choisir automatiquement lequel absorbe ce CBO.';
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
        -- Round 3 (Vincent, témoin 13) : une acceptation humaine terminale déjà posée sur
        -- ce thread prime sur le recalcul de voisinage/concurrence ci-dessous — revérifiée
        -- sous verrou (v_accepted_target_id a pu devenir invalide depuis le pré-calcul).
        IF v_accepted_target_id IS NOT NULL THEN
          SELECT * INTO v_target FROM public.tracked_point WHERE id = v_accepted_target_id FOR UPDATE;
          IF NOT FOUND OR v_target.status <> 'active' OR v_target.identity_status = 'CONFLICTED' THEN
            v_accepted_target_id := NULL;
          END IF;
        END IF;

        IF v_accepted_target_id IS NOT NULL THEN
          v_verdict := 'AUTO_LINKED';
          v_write_pattern := 'ATTACH_MEMBER';
          v_target_point_id := v_target.id;

        ELSE
        -- P6-A (§2.2) : concurrence live. D3 appliqué au tier thread-scoped d'abord
        -- (signal exact, prioritaire), puis au tier cross-thread en repli (D1, signal
        -- fuzzy — jamais auto-lié même unique, cf. tête de fichier). Verrou pris DANS la
        -- sous-requête (BUG 3a, Round 3) : array_agg ne peut pas se combiner à FOR UPDATE
        -- au même niveau, d'où le filtrage status/identity_status après verrou.
        SELECT array_agg(sub.id ORDER BY sub.id) INTO v_sibling_ids
        FROM (
          SELECT tp.id, tp.status, tp.identity_status
          FROM public.tracked_point_member tpm
          JOIN public.tracked_point tp ON tp.id = tpm.tracked_point_id
          WHERE tpm.subject_thread_id = p_thread_id AND tpm.status = 'active'
          ORDER BY tp.id
          FOR UPDATE OF tp
        ) sub
        WHERE sub.status = 'active' AND sub.identity_status <> 'CONFLICTED';

        IF array_length(v_sibling_ids, 1) = 1 THEN
          -- Déjà verrouillée par la sous-requête ci-dessus : pas de second FOR UPDATE.
          SELECT * INTO v_target FROM public.tracked_point WHERE id = v_sibling_ids[1];
          -- D3 : 1 cible thread-scoped compatible unique → AUTO_LINK.
          v_verdict := 'AUTO_LINKED';
          v_write_pattern := 'ATTACH_MEMBER';
          v_target_point_id := v_target.id;

        ELSIF array_length(v_sibling_ids, 1) > 1 THEN
          -- D3 : plusieurs cibles thread-scoped → contradiction, jamais un auto-choix.
          v_verdict := 'NEEDS_HUMAN';
          v_write_pattern := 'CREATE_CANDIDATES';
          v_candidate_point_ids := v_sibling_ids;
          v_candidate_reason := 'Plusieurs Points déjà rattachés à ce thread (membership HARD active) — impossible de choisir automatiquement.';
          v_target_point_id := NULL;

        ELSE
          -- 0 cible thread-scoped exploitable : D1 — revérifier live les candidats
          -- cross-thread calculés côté TS (evaluateMembershipCandidate, moteur Phase 4
          -- réutilisé tel quel, aucun rail llm câblé). Verrou pris DANS la sous-requête
          -- (BUG 3a, Round 3) : jamais fait confiance en aveugle, seuls les Points encore
          -- actifs/non-CONFLICTED comptent une fois verrouillés.
          SELECT array_agg(sub.id ORDER BY sub.id) INTO v_cross_thread_ids
          FROM (
            SELECT tp.id, tp.status, tp.identity_status
            FROM unnest(p_cross_thread_candidate_point_ids) AS cid
            JOIN public.tracked_point tp ON tp.id = cid
            ORDER BY tp.id
            FOR UPDATE OF tp
          ) sub
          WHERE sub.status = 'active' AND sub.identity_status <> 'CONFLICTED';

          SELECT p.* INTO v_pending FROM public.tracked_point_pending_trace p
          WHERE p.source_thread_id = p_thread_id AND p.status = 'pending'
          ORDER BY p.created_at ASC LIMIT 1;

          IF array_length(v_cross_thread_ids, 1) > 0 THEN
            -- D3 : signal cross-thread, toujours NEEDS_HUMAN quel que soit le nombre de
            -- candidats — jamais un auto-rattachement sur un signal fuzzy hors thread.
            v_verdict := 'NEEDS_HUMAN';
            v_write_pattern := 'CREATE_CANDIDATES';
            v_candidate_point_ids := v_cross_thread_ids;
            v_candidate_reason := 'Identité concurrente détectée hors de ce thread (correspondance déterministe cbo/exact/containment fort, moteur de voisinage Phase 4) — jamais un auto-rattachement sur un signal cross-thread.';
            v_target_point_id := NULL;
          ELSIF FOUND THEN
            -- Question déjà ouverte sur ce thread : ne pas la dupliquer, réutiliser
            -- telle quelle (0 nouvelle ligne).
            v_verdict := 'NEEDS_HUMAN';
            v_write_pattern := 'CREATE_PENDING_TRACE';
            v_target_point_id := NULL;
          ELSE
            v_verdict := 'AUTO_CREATED';
            v_write_pattern := 'CREATE_POINT_WITH_MEMBERSHIP';
          END IF;
        END IF;
        END IF;
      END IF;
    END IF;

  -- ── 6. Branche B — résolution/trackabilité en attente, aucun fondateur direct ──
  ELSIF p_planned_pending_trace IS NOT NULL THEN
    -- Round 3 (Vincent, témoin 13) : une acceptation humaine terminale déjà posée sur ce
    -- thread converge vers le Point confirmé AVANT toute lecture/création de pending
    -- trace — sans ce court-circuit en tête de branche, une résolution en attente
    -- redemanderait indéfiniment un arbitrage déjà tranché à chaque nouvelle unité.
    IF v_accepted_target_id IS NOT NULL THEN
      SELECT * INTO v_target FROM public.tracked_point WHERE id = v_accepted_target_id FOR UPDATE;
      IF NOT FOUND OR v_target.status <> 'active' OR v_target.identity_status = 'CONFLICTED' THEN
        v_accepted_target_id := NULL;
      END IF;
    END IF;

    IF v_accepted_target_id IS NOT NULL THEN
      v_verdict := 'AUTO_LINKED';
      v_write_pattern := 'ATTACH_MEMBER';
      v_target_point_id := v_target.id;
      -- Branche B ne calcule normalement jamais ces deux variables (propres au plan de
      -- la Branche A) : la recherche d'idempotence d'ATTACH_MEMBER (étape 8) en dépend.
      v_member_scope := 'thread';
      v_member_proposal_ids := NULL;

    ELSE
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
      v_pending_created := true;
    END IF;

    -- Voisinage thread-scoped uniquement — cette branche ne fonde déjà jamais de Point
    -- automatiquement, D1 (cross-thread) n'y ajoute rien (cf. tête de fichier). Verrou
    -- pris DANS la sous-requête (BUG 3a, Round 3) : array_agg ne peut pas se combiner à
    -- FOR UPDATE au même niveau, d'où le filtrage status/identity_status après verrou.
    SELECT array_agg(sub.id ORDER BY sub.id) INTO v_sibling_ids
    FROM (
      SELECT tp.id, tp.status, tp.identity_status
      FROM public.tracked_point_member tpm
      JOIN public.tracked_point tp ON tp.id = tpm.tracked_point_id
      WHERE tpm.subject_thread_id = p_thread_id AND tpm.status = 'active'
      ORDER BY tp.id
      FOR UPDATE OF tp
    ) sub
    WHERE sub.status = 'active' AND sub.identity_status <> 'CONFLICTED';

    v_write_pattern := CASE WHEN array_length(v_sibling_ids, 1) > 0 THEN 'CREATE_CANDIDATES' ELSE 'CREATE_PENDING_TRACE' END;
    v_candidate_point_ids := v_sibling_ids;
    v_candidate_reason := 'Point(s) déjà rattaché(s) à ce thread au moment de cette résolution en attente — cible(s) plausible(s) à confirmer.';
    v_target_point_id := NULL;
    END IF;

  -- ── 7. Branche C — rien à fonder, rien à faire arbitrer (D4) ──────────────
  ELSE
    v_verdict := 'IGNORED_NOT_TRACKABLE';
    v_write_pattern := 'IGNORE_NOT_TRACKABLE';
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

    -- Failpoint test-only (witness 14) — inerte hors base jetable avec harness dédié,
    -- cf. supabase/testing/p6_test_failpoint_harness.sql.
    IF current_setting('p6_test.fail_after_point_insert', true) = 'true' THEN
      RAISE EXCEPTION 'fn_reconcile_tracked_point_unit: TEST_INDUCED_FAILURE_AFTER_POINT_INSERT';
    END IF;

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

    -- Failpoint test-only (witness 14) — cf. ci-dessus.
    IF current_setting('p6_test.fail_after_point_insert', true) = 'true' THEN
      RAISE EXCEPTION 'fn_reconcile_tracked_point_unit: TEST_INDUCED_FAILURE_AFTER_POINT_INSERT';
    END IF;

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
      -- CTE + array_agg(RETURNING) : capture exactement ce que CETTE tentative a inséré,
      -- sans reselection heuristique (corrige l'ancien `RETURNING id INTO <array>` invalide
      -- sur un INSERT multi-lignes, et l'ancienne fenêtre `created_at >= now() - 1s`).
      WITH to_insert AS (
        SELECT cid FROM unnest(v_candidate_point_ids) AS cid
        WHERE NOT EXISTS (
          SELECT 1 FROM public.tracked_point_identity_candidate c
          WHERE c.candidate_point_id = cid AND c.subject_thread_id = p_thread_id
            AND c.scope = 'thread' AND c.status = 'pending'
        )
      ),
      inserted AS (
        INSERT INTO public.tracked_point_identity_candidate (site_id, candidate_point_id, subject_thread_id, scope, reason)
        SELECT p_site_id, cid, p_thread_id, 'thread', v_candidate_reason
        FROM to_insert
        RETURNING id
      )
      SELECT array_agg(id) INTO v_new_candidate_ids FROM inserted;
    END IF;
  END IF;

  -- ── 9. reconcile_state UPSERT + reconcile_event + reconcile_artifact (§2.6) ──
  -- Verrou niveau 8 (§2.8) : pris ici par l'UPSERT, après tous les niveaux inférieurs.
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
    IF v_pending_created THEN
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

COMMENT ON FUNCTION public.fn_reconcile_tracked_point_unit(UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, UUID, JSONB, JSONB, UUID[]) IS
  'P6 Live Writer — RPC unique d''écriture pour UNE FoundingUnit déjà classifiée (decideFoundingV2) et déjà transformée en plan pur (planPointForUnit/planPendingTraceForUnit). Verrouille §2.8 (domaine identité thread, unité, puis CBO/pending/point(s)/member/candidate(s), reconcile_state en dernier), revalide contre l''état live avant toute conclusion NOOP (§2.5, jamais sur la seule égalité de fingerprint), exécute un des 8 gestes du §2.1 (7 figés + IGNORE_NOT_TRACKABLE, D4). P6-B (merged/CONFLICTED ⇒ toujours NEEDS_HUMAN) et P6-C (founding_kind/founding_reference immuables, CBO tardif ⇒ ENRICH_EXISTING_POINT seul) appliqués sans exception. D1 (Round 2) : une concurrence cross-thread connue (p_cross_thread_candidate_point_ids, calculée côté TS via le moteur Phase 4 evaluateMembershipCandidate réutilisé tel quel, jamais un second moteur de décision) est revérifiée live et empêche toute autocréation PROVISIONAL silencieuse, sans jamais s''auto-lier (D3 : signal fuzzy, toujours NEEDS_HUMAN). D3 : 0 cible compatible ⇒ AUTO_CREATE, 1 cible thread-scoped compatible unique ⇒ AUTO_LINK, plus d''1 ou contradiction ⇒ NEEDS_HUMAN. SECURITY DEFINER durci (search_path vide, EXECUTE réservé à service_role). NON EXÉCUTÉ : aucun des 16 témoins de la matrice §5 n''a pu être lancé (pas d''accès DB dans ce lot).';

REVOKE ALL ON FUNCTION public.fn_reconcile_tracked_point_unit(UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, UUID, JSONB, JSONB, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reconcile_tracked_point_unit(UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, UUID, JSONB, JSONB, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.fn_reconcile_tracked_point_unit(UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, UUID, JSONB, JSONB, UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_tracked_point_unit(UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, UUID, JSONB, JSONB, UUID[]) TO service_role;
