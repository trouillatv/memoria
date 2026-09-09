-- Migration 403 : fn_reconcile_tracked_point_unit — correctif évolution proposal_set
-- (P6 — DERNIER CONTRÔLE PROPOSAL_SET AVANT ACTIVATION, arbitrage Vincent/ChatGPT).
--
-- NO GO APPLY — cette migration n'est pas appliquée par ce lot (mandat explicite Vincent :
-- "Aucune migration appliquée sans GO Vincent"). Fichier écrit, non exécuté.
--
-- ── Bug confirmé (témoin exécuté, cf. rapport HARD STOP) ──────────────────────────────────
--
-- Un proposal_set qui évolue de proposal_ids=[A] à [A,B] (B de même proposal_family/CBO/
-- outcomeV2/trackability que A) produisait AVANT ce lot un input_fingerprint IDENTIQUE entre
-- les deux états (lib/knowledge/tracked-point-fingerprint.ts n'incluait pas proposal_ids dans
-- InputSnapshot). Le fast-path NOOP de fn_reconcile_tracked_point_unit (migration 401, §4)
-- rejouait alors la première réconciliation sans jamais faire entrer B dans
-- tracked_point_member.proposal_ids — seule source de preuve consommée par le read-model pour
-- ce scope (invariant GO 6B.1, lib/knowledge/tracked-point-read-model.ts lignes 23-28 :
-- "scope='proposal_set' consomme EXCLUSIVEMENT tracked_point_member.proposal_ids, jamais le
-- thread entier"). B disparaissait donc silencieusement de la preuve du Point.
--
-- ── Correctif — deux couches, sémantique append-only conservatrice (arbitrage Vincent) ────
--
-- 1. TS (lib/knowledge/tracked-point-fingerprint.ts, hors de cette migration) : InputSnapshot
--    porte désormais `proposalIds` (composition canonique triée, scope=proposal_set
--    uniquement) — [A] et [A,B] produisent maintenant deux fingerprints DIFFÉRENTS. C'est la
--    protection PRINCIPALE : dès que la composition change, le fast-path ci-dessous n'est
--    même plus atteint (l'égalité de fingerprint à l'étape 4 échoue), la fonction retombe
--    directement dans la revalidation complète (Branche A), qui atteint ATTACH_MEMBER et
--    ajoute une NOUVELLE ligne tracked_point_member pour [A,B] — SANS jamais retirer, retirer
--    ou marquer "superseded" la ligne [A] existante (choix délibéré : un sous-ensemble strict
--    ne prouve pas qu'il s'agit de la version précédente de CE proposal_set — plusieurs
--    sous-ensembles d'un même thread peuvent légitimement représenter des conditions
--    distinctes, migration 400 tracked_point_member_active_proposal_set_uidx). Le read-model
--    actuel (allExplicitProposalIds, tracked-point-read-model.ts) consomme déjà un Set de
--    proposal_ids à travers toutes les memberships actives d'un Point : [A] actif + [A,B]
--    actif restitue la preuve {A,B} une seule fois chacune, jamais {A,A,B}.
--
-- 2. SQL (cette migration) : protection SECONDAIRE, défense en profondeur. Le fast-path NOOP
--    pour write_pattern='ATTACH_MEMBER' ne se contente plus de vérifier qu'UNE membership
--    active quelconque existe sur (target_point_id, thread) — il vérifie qu'il existe une
--    membership active dont le SCOPE et, pour proposal_set, la composition canonique
--    (triée) de proposal_ids correspondent EXACTEMENT à ce que l'unité courante attend. Cela
--    couvre le cas défensif où une anomalie de données (fingerprint stocké désynchronisé du
--    code TS, ex. déploiement partiel) ferait à tort croire à un rejeu identique. Comparaison
--    par ensemble trié (pas par ordre d'insertion) : la composition est un ENSEMBLE, pas une
--    séquence — cohérent avec le tri appliqué côté TS.
--
--    ENRICH_EXISTING_POINT n'est PAS touché (mandat Vincent : "ne généralise à
--    ENRICH_EXISTING_POINT que si son contrat actuel attend réellement cette même
--    membership ; ne rouvre pas son architecture"). Ce write_pattern n'écrit jamais lui-même
--    de tracked_point_member (§8, migration 401, lignes 757-759 : seul canonical_business_
--    object.tracked_point_id est mis à jour) — la membership active trouvée sur le thread par
--    son propre fast-path peut légitimement appartenir à une IDENTITÉ DIFFÉRENTE de celle du
--    plan courant (ex. sibling trackable_condition thread-scoped préexistant). Exiger une
--    correspondance exacte de scope/proposal_ids romprait ce contrat sans bénéfice : la seule
--    garantie utile ici reste "le Point cible est toujours actif/non-CONFLICTED", inchangée.
--
--    La branche normale ATTACH_MEMBER (§8, migration 401, lignes 739-755) N'EST PAS modifiée :
--    elle continue d'ajouter une nouvelle ligne quand la composition diffère, sans jamais
--    retirer les compositions actives existantes (mandat Vincent explicite).
--
-- Live Writer : allowlist TRACKED_POINT_LIVE_WRITER_SITE_IDS toujours vide (OFF). Aucune
-- donnée OCEF touchée par ce lot.

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
  p_cross_thread_candidate_point_ids UUID[] DEFAULT '{}'::UUID[],
  p_fallback_pending_trace JSONB DEFAULT NULL
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
  v_pending_contract      JSONB;
  v_early_pending_contract JSONB;
  -- Migration 403 : composition attendue par l'unité courante, extraite de p_input_snapshot,
  -- pour le fast-path ATTACH_MEMBER exact ci-dessous (§4). Triée pour comparer un ENSEMBLE,
  -- pas une séquence (même convention que buildInputSnapshot côté TS).
  v_snapshot_scope        TEXT;
  v_snapshot_proposal_ids UUID[];
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

    -- Migration 403 : ATTACH_MEMBER exige désormais une membership active dont le scope et,
    -- pour proposal_set, la composition canonique (triée) de proposal_ids correspondent
    -- EXACTEMENT à ce que l'unité courante attend (p_input_snapshot) — défense en profondeur,
    -- la protection principale reste le fingerprint (qui inclut désormais proposalIds côté TS
    -- et ne matche déjà plus si la composition a changé). ENRICH_EXISTING_POINT reste sur
    -- l'ancien contrat inchangé (voir commentaire de tête de migration).
    IF v_prev_state.write_pattern = 'ATTACH_MEMBER' THEN
      SELECT * INTO v_target FROM public.tracked_point WHERE id = v_prev_state.target_point_id FOR UPDATE;
      IF FOUND AND v_target.status = 'active' AND v_target.identity_status <> 'CONFLICTED' THEN
        v_snapshot_scope := p_input_snapshot->>'scope';
        v_snapshot_proposal_ids := CASE
          WHEN p_input_snapshot->'proposalIds' IS NULL OR p_input_snapshot->'proposalIds' = 'null'::jsonb THEN NULL
          ELSE (SELECT array_agg(elem ORDER BY elem) FROM jsonb_array_elements_text(p_input_snapshot->'proposalIds') AS elem)::UUID[]
        END;

        SELECT m.id INTO v_member_id FROM public.tracked_point_member m
        WHERE m.tracked_point_id = v_target.id AND m.subject_thread_id = p_thread_id AND m.status = 'active'
          AND m.scope = v_snapshot_scope
          AND (
            (v_snapshot_scope = 'thread' AND m.proposal_ids IS NULL)
            OR (v_snapshot_scope = 'proposal_set' AND (SELECT array_agg(x ORDER BY x) FROM unnest(m.proposal_ids) AS x) = v_snapshot_proposal_ids)
          )
        LIMIT 1;
        IF v_member_id IS NOT NULL THEN
          v_noop_compatible := true;
        END IF;
      END IF;

    ELSIF v_prev_state.write_pattern = 'ENRICH_EXISTING_POINT' THEN
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

  -- ── 4.5. Pré-verrouillage anticipé d'une pending trace existante (Round 5,
  --      Vincent, BLOCKER 1) — AVANT tout FOR UPDATE de tracked_point (niveau 5).
  --
  --      Cause : associate_pending_resolution_to_point (migration 396, déjà
  --      appliquée) verrouille la pending trace PUIS le tracked_point cible — ordre
  --      inverse de celui suivi jusqu'ici par cette fonction (Point(s) d'abord,
  --      pending seulement à l'étape 7.5). Deux ordres opposés sur les deux mêmes
  --      verrous = cycle de deadlock réel (Live Writer : Point→pending ;
  --      396 : pending→Point). Correctif : verrouiller la pending trace ICI, avant
  --      le premier FOR UPDATE de tracked_point de Branche A/B, pour que TOUTE
  --      transaction de cette fonction respecte désormais l'ordre pending→Point,
  --      identique à celui de 396.
  --
  --      v_early_pending_contract = COALESCE(p_planned_pending_trace,
  --      p_fallback_pending_trace) : exactement les deux mêmes paramètres RPC-input
  --      qui alimenteront plus tard v_pending_contract dans Branche A (dégradée) ou
  --      Branche B — jamais une troisième source. Le kind verrouillé ici est donc
  --      TOUJOURS celui que l'étape 7.5 chercherait de toute façon.
  --
  --      AUCUNE création ici : uniquement un SELECT ... FOR UPDATE sur une ligne
  --      DÉJÀ existante. Si elle existe, elle reste verrouillée jusqu'à COMMIT et
  --      sera réutilisée par l'étape 7.5 (son propre SELECT la retrouvera identique,
  --      son guard v_pending.id IS NULL sera déjà faux → pas de second SELECT ni
  --      d'INSERT). Si rien n'existe, v_pending reste NULL et l'étape 7.5 fonctionne
  --      exactement comme avant (seule habilitée à créer, Round 4).
  --
  --      393 (accept_trace_identity_candidate) et 395 (confirm_pending_trackability)
  --      vérifiés (Round 5) : aucun cycle supplémentaire. 393 verrouille un candidat
  --      PRÉEXISTANT puis le Point cible — cette fonction ne verrouille jamais un
  --      candidat préexistant avant son propre Point (elle ne fait qu'INSÉRER de
  --      nouvelles candidates, sans verrou, après avoir verrouillé le Point).
  --      395 ne verrouille jamais un tracked_point préexistant (INSERT seul, kind
  --      TRACKABILITY_UNDETERMINED exclusivement) — aucune inversion possible.
  v_early_pending_contract := COALESCE(p_planned_pending_trace, p_fallback_pending_trace);
  IF v_early_pending_contract IS NOT NULL THEN
    SELECT p.* INTO v_pending
    FROM public.tracked_point_pending_trace p
    WHERE p.source_thread_id = p_thread_id
      AND p.kind = (v_early_pending_contract->>'kind')
      AND p.status = 'pending'
    FOR UPDATE;

    -- Pause test-only (Round 5, témoin de concurrence, préparé — PAS exécuté ce lot) —
    -- même doctrine que le failpoint du witness 14 : GUC de session
    -- `p6_test.pause_ms_after_pending_lock`, lu via current_setting(..., missing_ok=true),
    -- inerte par construction (jamais positionné hors d'un harness test-only dédié, jamais
    -- accordé/atteignable sur la base cible réelle). Ne s'exerce que si la ligne a
    -- effectivement été trouvée ET verrouillée (v_pending.id IS NOT NULL) : mettre en pause
    -- alors qu'aucun verrou n'est tenu ne prouverait rien. Objectif du témoin : élargir
    -- délibérément la fenêtre pendant laquelle CETTE transaction tient le verrou sur la
    -- pending trace, pour qu'une transaction concurrente lancée peu après (associate_pending_
    -- resolution_to_point, migration 396, qui verrouille cette même pending trace EN PREMIER)
    -- ait le temps réel de tenter et de bloquer sur ce même verrou pendant la pause, plutôt
    -- que de dépendre d'un minutage non garanti (Promise.all seul, témoins 11/12/15).
    IF v_pending.id IS NOT NULL THEN
      DECLARE
        v_pause_ms TEXT := current_setting('p6_test.pause_ms_after_pending_lock', true);
      BEGIN
        IF v_pause_ms IS NOT NULL AND v_pause_ms <> '' THEN
          PERFORM pg_sleep(v_pause_ms::NUMERIC / 1000.0);
        END IF;
      END;
    END IF;
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
          IF p_fallback_pending_trace IS NOT NULL THEN
            v_pending_contract := jsonb_build_object(
              'kind', p_fallback_pending_trace->>'kind',
              'reason', CASE WHEN v_target.status = 'merged'
                THEN 'Le Point déjà lié à ce CBO (' || v_cbo.id::text || ') a été fusionné (merged) — cible non exploitable automatiquement, jamais suggérée (D2).'
                ELSE 'Le Point déjà lié à ce CBO (' || v_cbo.id::text || ') est en conflit d''identité (CONFLICTED) — cible non exploitable automatiquement, jamais suggérée (D2).'
              END
            );
          END IF;
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
            IF p_fallback_pending_trace IS NOT NULL THEN
              v_pending_contract := jsonb_build_object('kind', p_fallback_pending_trace->>'kind', 'reason', v_candidate_reason);
            END IF;
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
          IF p_fallback_pending_trace IS NOT NULL THEN
            v_pending_contract := jsonb_build_object(
              'kind', p_fallback_pending_trace->>'kind',
              'reason', CASE WHEN v_target.status = 'merged'
                THEN 'Le Point déjà fondé sur cette identité (' || p_unit_key || ') a été fusionné (merged) — cible non exploitable automatiquement.'
                ELSE 'Le Point déjà fondé sur cette identité (' || p_unit_key || ') est en conflit d''identité (CONFLICTED) — cible non exploitable automatiquement.'
              END
            );
          END IF;
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
          IF p_fallback_pending_trace IS NOT NULL THEN
            v_pending_contract := jsonb_build_object('kind', p_fallback_pending_trace->>'kind', 'reason', v_candidate_reason);
          END IF;

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

          -- Round 6 (Vincent, BLOCKER contamination des kinds de pending) — l'ancien
          -- SELECT ici (sans filtre kind, sans verrou) écrasait v_pending déjà correctement
          -- chargée et verrouillée par le pré-verrou §4.5 (filtré sur
          -- v_early_pending_contract->>'kind', qui vaut TOUJOURS 'IDENTITY_UNRESOLVED' dans
          -- cette branche puisque p_fallback_pending_trace est le seul contrat disponible
          -- ici). Ce second SELECT non filtré pouvait réutiliser/rapporter une pending trace
          -- d'un AUTRE kind (ex. RESOLUTION_WITHOUT_KNOWN_PROBLEM) simplement parce qu'elle
          -- partageait le même source_thread_id — contaminant le diagnostic exposé
          -- (pendingTraceId) et pouvant désactiver à tort la garde §7.5. Supprimé : v_pending
          -- reste celle, déjà correcte, posée par §4.5.
          IF array_length(v_cross_thread_ids, 1) > 0 THEN
            -- D3 : signal cross-thread, toujours NEEDS_HUMAN quel que soit le nombre de
            -- candidats — jamais un auto-rattachement sur un signal fuzzy hors thread.
            v_verdict := 'NEEDS_HUMAN';
            v_write_pattern := 'CREATE_CANDIDATES';
            v_candidate_point_ids := v_cross_thread_ids;
            v_candidate_reason := 'Identité concurrente détectée hors de ce thread (correspondance déterministe cbo/exact/containment fort, moteur de voisinage Phase 4) — jamais un auto-rattachement sur un signal cross-thread.';
            v_target_point_id := NULL;
            IF p_fallback_pending_trace IS NOT NULL THEN
              v_pending_contract := jsonb_build_object('kind', p_fallback_pending_trace->>'kind', 'reason', v_candidate_reason);
            END IF;
          ELSIF v_pending.id IS NOT NULL THEN
            -- Question IDENTITY_UNRESOLVED déjà ouverte sur ce thread (verrouillée par
            -- §4.5, kind garanti = celui du contrat courant) : ne pas la dupliquer,
            -- réutiliser telle quelle (0 nouvelle ligne). Aucun v_pending_contract
            -- nécessaire, l'étape 7.5 se voit désactivée par sa propre garde
            -- (v_pending.id IS NULL) pour cette sous-branche précisément.
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

    -- Round 4 (BUG 1) : la matérialisation elle-même est déportée dans la primitive
    -- commune (étape 7.5, ci-dessous) — cette branche ne fait plus que déclarer SON
    -- contrat (kind/reason déjà précis, inchangé depuis planPendingTraceForUnit).
    v_pending_contract := p_planned_pending_trace;

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

  -- ── 7.5. Primitive commune "ensure pending trace" (Round 4, Vincent — BUG 1) ──
  --
  -- Point unique de matérialisation d'une tracked_point_pending_trace pour TOUT
  -- write_pattern CREATE_PENDING_TRACE/CREATE_CANDIDATES, qu'il vienne de la
  -- Branche A dégradée (contrat = p_fallback_pending_trace, kind=IDENTITY_UNRESOLVED)
  -- ou de la Branche B (contrat = p_planned_pending_trace). Les deux branches ne
  -- font plus qu'écrire leur `reason` précise dans v_pending_contract (étape 6/7
  -- ci-dessus) — plus aucune n'insère elle-même.
  --
  -- Garde v_pending.id IS NULL : la section D1 cross-thread (branche
  -- "ELSIF v_pending.id IS NOT NULL", Round 6) a pu déjà résoudre v_pending via le
  -- pré-verrou §4.5 (kind garanti = celui du contrat courant, jamais un kind
  -- étranger depuis Round 6) avant d'atteindre ce point — dans ce cas précis, cette
  -- étape ne doit rien insérer (0 nouvelle ligne, comportement inchangé depuis avant
  -- ce round).
  IF v_write_pattern IN ('CREATE_PENDING_TRACE', 'CREATE_CANDIDATES') AND v_pending.id IS NULL THEN
    IF v_pending_contract IS NULL THEN
      RAISE EXCEPTION 'fn_reconcile_tracked_point_unit: MISSING_PENDING_CONTRACT — write_pattern=% atteint sans p_planned_pending_trace ni p_fallback_pending_trace exploitable (unit_key=%)', v_write_pattern, p_unit_key;
    END IF;

    SELECT p.* INTO v_pending FROM public.tracked_point_pending_trace p
    WHERE p.source_thread_id = p_thread_id
      AND p.kind = (v_pending_contract->>'kind')
      AND p.status = 'pending'
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.tracked_point_pending_trace (site_id, source_thread_id, kind, reason)
      VALUES (p_site_id, p_thread_id, v_pending_contract->>'kind', v_pending_contract->>'reason')
      RETURNING * INTO v_pending;
      v_pending_created := true;
    END IF;
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

COMMENT ON FUNCTION public.fn_reconcile_tracked_point_unit(UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, UUID, JSONB, JSONB, UUID[], JSONB) IS
  'P6 Live Writer — RPC unique d''écriture pour UNE FoundingUnit déjà classifiée (decideFoundingV2) et déjà transformée en plan pur (planPointForUnit/planPendingTraceForUnit). Migration 403 : le fast-path NOOP d''ATTACH_MEMBER exige désormais une membership active de scope/proposal_ids EXACTEMENT identiques à ce qu''attend l''unité courante (défense en profondeur — la protection principale est le fingerprint TS, qui inclut désormais proposalIds pour scope=proposal_set) ; ENRICH_EXISTING_POINT reste inchangé (ne porte pas sa propre membership). Verrouille §2.8 (domaine identité thread, unité, puis CBO, puis pending trace EXISTANTE le cas échéant — pré-verrou §4.5, Round 5, jamais de création à ce stade —, puis tracked_point(s)/member/candidate(s)) ; la primitive commune §7.5 réutilise cette même pending trace ou en crée une nouvelle si aucune n''existait. Cet ordre (CBO, pending, tracked_point) aligne cette fonction sur associate_pending_resolution_to_point (migration 396 : pending puis target). Revalide contre l''état live avant toute conclusion NOOP (§2.5, jamais sur la seule égalité de fingerprint), exécute un des 8 gestes du §2.1 (7 figés + IGNORE_NOT_TRACKABLE, D4). P6-B (merged/CONFLICTED ⇒ toujours NEEDS_HUMAN) et P6-C (founding_kind/founding_reference immuables, CBO tardif ⇒ ENRICH_EXISTING_POINT seul) appliqués sans exception. D1 (Round 2) : une concurrence cross-thread connue est revérifiée live et empêche toute autocréation PROVISIONAL silencieuse, sans jamais s''auto-lier (D3 : signal fuzzy, toujours NEEDS_HUMAN). D3 : 0 cible compatible ⇒ AUTO_CREATE, 1 cible thread-scoped compatible unique ⇒ AUTO_LINK, plus d''1 ou contradiction ⇒ NEEDS_HUMAN. p_fallback_pending_trace (kind=IDENTITY_UNRESOLVED, migration 400) porte un contrat de repli SÉPARÉ du plan principal, consommé uniquement si la Branche A dégrade effectivement le plan de Point en NEEDS_HUMAN. SECURITY DEFINER durci (search_path vide, EXECUTE réservé à service_role). NO GO APPLY — non appliquée par ce lot (mandat Vincent).';

REVOKE ALL ON FUNCTION public.fn_reconcile_tracked_point_unit(UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, UUID, JSONB, JSONB, UUID[], JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reconcile_tracked_point_unit(UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, UUID, JSONB, JSONB, UUID[], JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.fn_reconcile_tracked_point_unit(UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, UUID, JSONB, JSONB, UUID[], JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_tracked_point_unit(UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, UUID, JSONB, JSONB, UUID[], JSONB) TO service_role;
