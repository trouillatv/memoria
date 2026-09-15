-- Migration 408 : PENDING EVIDENCE — extension native (P0-1A-2a)
--
-- Décision explicite de Vincent (2026-09-15), verbatim : GO sur l'option 2 — extension
-- additive TRÈS BORNÉE du mécanisme de preuve pending trace (migration 394) pour
-- accepter une seconde famille de preuve, native (site_knowledge_proposals), en plus de
-- la famille historique (document_extraction_proposal). PAS de refonte générique du
-- mécanisme (un pattern source_kind/source_id sans FK a été explicitement écarté par
-- Vincent : "on perdrait l'intégrité référentielle précisément sur une table de
-- preuve"). Deux FK explicites + XOR, plus verbeux mais plus sûrs.
--
-- Contrat exact (verbatim Vincent) :
--   - conserver proposal_id historique tel quel ;
--   - ajouter native_proposal_id nullable vers site_knowledge_proposals(id) ;
--   - contrainte XOR stricte : exactement une des deux références est renseignée ;
--   - ne pas supprimer ni relâcher la FK historique existante ;
--   - adapter resolve_pending_trace_evidence pour accepter les deux familles de
--     preuve, sans changer son sens ;
--   - confirm_pending_trackability continue d'exiger evidence_status='resolved' ;
--   - aucune dérivation de open/resolved depuis site_knowledge_proposals.status
--     (NO-GO permanent déjà posé sur ce mapping, cf. mémoire
--     p0-1a-live-writer-native-confirmed-only) ;
--   - aucun impact sur les traces historiques existantes.
--
-- Découpage du lot (Vincent) :
--   P0-1A-2a (ce fichier) — étendre la preuve pending trace au natif (schéma + RPC).
--   P0-1A-2b (hors périmètre, non démarré) — produire PENDING_TRACKABILITY natif et
--     câbler le geste humain jusqu'au bout dans l'adaptateur natif.
--
-- Périmètre du "thread" natif : l'adaptateur natif CONFIRMED-only (P0-1A-1,
-- lib/db/tracked-point-live-writer-native-adapter.ts) utilise déjà le
-- canonical_subject_id résolu à sa racine (post-merge, cf. makeSubjectResolver.
-- resolveRoot) DIRECTEMENT comme tracked_point_member.subject_thread_id — convention
-- actée par 388/400 ("subject_thread_id = UUID libre, sans table dédiée"). La
-- validation de "même thread" pour une preuve native compare donc
-- canonical_subject_resolve_root(site_knowledge_proposals.canonical_subject_id) au
-- source_thread_id de la pending trace, sans passer par subject_thread_identity
-- (celle-ci reste réservée à la famille historique — cf. guard ABORT existant, inchangé).

-- ── 1. Schéma : XOR entre les deux familles de preuve ──────────────────────────────
-- L'ancienne PK composite (pending_trace_id, proposal_id) ne peut plus être la clé
-- primaire dès lors que proposal_id devient nullable : surrogate id + deux index
-- uniques partiels (un par famille), qui servent aussi de cibles ON CONFLICT.

ALTER TABLE public.tracked_point_pending_trace_evidence
  DROP CONSTRAINT tracked_point_pending_trace_evidence_pkey;

ALTER TABLE public.tracked_point_pending_trace_evidence
  ALTER COLUMN proposal_id DROP NOT NULL;

ALTER TABLE public.tracked_point_pending_trace_evidence
  ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.tracked_point_pending_trace_evidence
  ADD CONSTRAINT tracked_point_pending_trace_evidence_pkey PRIMARY KEY (id);

ALTER TABLE public.tracked_point_pending_trace_evidence
  ADD COLUMN native_proposal_id UUID REFERENCES public.site_knowledge_proposals(id) ON DELETE RESTRICT;

ALTER TABLE public.tracked_point_pending_trace_evidence
  ADD CONSTRAINT tracked_point_pending_trace_evidence_family_xor
    CHECK ((proposal_id IS NOT NULL) <> (native_proposal_id IS NOT NULL));

CREATE UNIQUE INDEX tracked_point_pending_trace_evidence_historical_uniq
  ON public.tracked_point_pending_trace_evidence (pending_trace_id, proposal_id)
  WHERE proposal_id IS NOT NULL;

CREATE UNIQUE INDEX tracked_point_pending_trace_evidence_native_uniq
  ON public.tracked_point_pending_trace_evidence (pending_trace_id, native_proposal_id)
  WHERE native_proposal_id IS NOT NULL;

CREATE INDEX ON public.tracked_point_pending_trace_evidence (native_proposal_id);

-- ── 2. Résolution de racine canonical_subject (miroir SQL de resolveRoot) ──────────
-- lib/db/tracked-point-live-writer-native-adapter.ts::makeSubjectResolver.resolveRoot —
-- boucle sûre aux cycles (arrêt dès qu'un id déjà vu réapparaît, comme le Set `seen`
-- en TS).

CREATE OR REPLACE FUNCTION public.canonical_subject_resolve_root(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cur  UUID := p_id;
  v_next UUID;
  v_seen UUID[] := ARRAY[]::UUID[];
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  WHILE NOT (v_cur = ANY(v_seen)) LOOP
    v_seen := array_append(v_seen, v_cur);
    SELECT merged_into INTO v_next FROM public.canonical_subject WHERE id = v_cur;
    IF v_next IS NULL THEN
      RETURN v_cur;
    END IF;
    v_cur := v_next;
  END LOOP;

  RETURN v_cur;
END;
$$;

COMMENT ON FUNCTION public.canonical_subject_resolve_root(UUID) IS
  'Miroir SQL de resolveRoot (lib/db/tracked-point-live-writer-native-adapter.ts) — suit merged_into jusqu''à la racine, sûr aux cycles. Utilisé pour valider qu''une preuve native (site_knowledge_proposals.canonical_subject_id) appartient au même thread qu''une pending trace.';

-- ── 3. Garde de cohérence de thread — étendue aux deux familles ────────────────────

CREATE OR REPLACE FUNCTION public.tracked_point_pending_trace_evidence_thread_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_pending_thread_id  UUID;
  v_proposal_thread_id UUID;
  v_native_subject_id  UUID;
  v_native_root_id     UUID;
BEGIN
  SELECT source_thread_id INTO v_pending_thread_id
  FROM public.tracked_point_pending_trace WHERE id = NEW.pending_trace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tracked_point_pending_trace_evidence: pending_trace_id % introuvable', NEW.pending_trace_id;
  END IF;

  IF NEW.proposal_id IS NOT NULL THEN
    SELECT subject_thread_id INTO v_proposal_thread_id
    FROM public.document_extraction_proposal WHERE id = NEW.proposal_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'tracked_point_pending_trace_evidence: proposal_id % introuvable', NEW.proposal_id;
    END IF;

    IF v_proposal_thread_id IS DISTINCT FROM v_pending_thread_id THEN
      RAISE EXCEPTION 'tracked_point_pending_trace_evidence: proposal % (thread %) n''appartient pas au thread de la pending trace % (thread %)',
        NEW.proposal_id, v_proposal_thread_id, NEW.pending_trace_id, v_pending_thread_id;
    END IF;
  ELSE
    -- Famille native (P0-1A-2a) : le "thread" est le canonical_subject résolu à sa
    -- racine (même convention que l'adaptateur natif CONFIRMED-only, P0-1A-1) —
    -- jamais une jointure via subject_thread_identity (réservée à l'historique).
    SELECT canonical_subject_id INTO v_native_subject_id
    FROM public.site_knowledge_proposals WHERE id = NEW.native_proposal_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'tracked_point_pending_trace_evidence: native_proposal_id % introuvable', NEW.native_proposal_id;
    END IF;

    v_native_root_id := public.canonical_subject_resolve_root(v_native_subject_id);

    IF v_native_root_id IS DISTINCT FROM v_pending_thread_id THEN
      RAISE EXCEPTION 'tracked_point_pending_trace_evidence: proposition native % (sujet racine %) n''appartient pas au thread de la pending trace % (thread %)',
        NEW.native_proposal_id, v_native_root_id, NEW.pending_trace_id, v_pending_thread_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4. Writer atomique — étendu aux deux familles, sens inchangé ───────────────────
-- CREATE OR REPLACE ne peut pas ajouter de paramètre à une fonction existante sans
-- créer un overload distinct : DROP explicite puis re-création avec le nouveau
-- paramètre en dernière position (DEFAULT NULL), pour ne changer ni l'ordre ni le
-- caractère obligatoire des trois paramètres existants (appels PostgREST nommés,
-- inchangés).

DROP FUNCTION public.resolve_pending_trace_evidence(UUID, UUID[], TEXT);

CREATE FUNCTION public.resolve_pending_trace_evidence(
  p_pending_trace_id    UUID,
  p_proposal_ids        UUID[],
  p_evidence_basis      TEXT,
  p_native_proposal_ids UUID[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending              public.tracked_point_pending_trace%ROWTYPE;
  v_id                   UUID;
  v_existing_hist_ids    UUID[];
  v_existing_native_ids  UUID[];
  v_requested_hist_ids   UUID[];
  v_requested_native_ids UUID[];
  v_inserted_count       INT := 0;
BEGIN
  IF p_evidence_basis IS NULL OR p_evidence_basis NOT IN ('exact_single_proposal', 'whole_thread_proven_safe', 'human_selected') THEN
    RAISE EXCEPTION 'resolve_pending_trace_evidence: evidence_basis invalide (%)', p_evidence_basis;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::UUID[]) INTO v_requested_hist_ids
  FROM unnest(COALESCE(p_proposal_ids, ARRAY[]::UUID[])) AS x;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::UUID[]) INTO v_requested_native_ids
  FROM unnest(COALESCE(p_native_proposal_ids, ARRAY[]::UUID[])) AS x;

  IF cardinality(v_requested_hist_ids) = 0 AND cardinality(v_requested_native_ids) = 0 THEN
    RAISE EXCEPTION 'resolve_pending_trace_evidence: aucune preuve fournie (p_proposal_ids et p_native_proposal_ids vides) — au moins une proposition attendue';
  END IF;

  SELECT * INTO v_pending FROM public.tracked_point_pending_trace WHERE id = p_pending_trace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolve_pending_trace_evidence: pending trace introuvable (%)', p_pending_trace_id;
  END IF;

  IF v_pending.evidence_status = 'resolved' THEN
    SELECT COALESCE(array_agg(proposal_id ORDER BY proposal_id), ARRAY[]::UUID[]) INTO v_existing_hist_ids
    FROM public.tracked_point_pending_trace_evidence
    WHERE pending_trace_id = p_pending_trace_id AND proposal_id IS NOT NULL;
    SELECT COALESCE(array_agg(native_proposal_id ORDER BY native_proposal_id), ARRAY[]::UUID[]) INTO v_existing_native_ids
    FROM public.tracked_point_pending_trace_evidence
    WHERE pending_trace_id = p_pending_trace_id AND native_proposal_id IS NOT NULL;

    IF v_pending.evidence_basis = p_evidence_basis
       AND v_existing_hist_ids = v_requested_hist_ids
       AND v_existing_native_ids = v_requested_native_ids THEN
      RETURN jsonb_build_object(
        'pendingTraceId', p_pending_trace_id,
        'result', 'already_resolved',
        'evidenceCount', cardinality(v_existing_hist_ids) + cardinality(v_existing_native_ids)
      );
    END IF;

    RAISE EXCEPTION 'resolve_pending_trace_evidence: pending trace % déjà résolue avec un jeu de preuves différent (basis=%, proposals=%, native_proposals=%)',
      p_pending_trace_id, v_pending.evidence_basis, v_existing_hist_ids, v_existing_native_ids;
  END IF;

  FOREACH v_id IN ARRAY v_requested_hist_ids LOOP
    INSERT INTO public.tracked_point_pending_trace_evidence (pending_trace_id, proposal_id)
    VALUES (p_pending_trace_id, v_id)
    ON CONFLICT (pending_trace_id, proposal_id) WHERE proposal_id IS NOT NULL DO NOTHING;
    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  FOREACH v_id IN ARRAY v_requested_native_ids LOOP
    INSERT INTO public.tracked_point_pending_trace_evidence (pending_trace_id, native_proposal_id)
    VALUES (p_pending_trace_id, v_id)
    ON CONFLICT (pending_trace_id, native_proposal_id) WHERE native_proposal_id IS NOT NULL DO NOTHING;
    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  UPDATE public.tracked_point_pending_trace
  SET evidence_status = 'resolved', evidence_basis = p_evidence_basis
  WHERE id = p_pending_trace_id;

  RETURN jsonb_build_object(
    'pendingTraceId', p_pending_trace_id,
    'result', 'resolved',
    'evidenceBasis', p_evidence_basis,
    'evidenceCount', v_inserted_count
  );
END;
$$;

COMMENT ON FUNCTION public.resolve_pending_trace_evidence(UUID, UUID[], TEXT, UUID[]) IS
  'P0-1A-2a — étend 6E.3B.1 (mig 394) aux deux familles de preuve (historique document_extraction_proposal + native site_knowledge_proposals). Sens inchangé : fige un jeu exact de propositions par famille (jamais une référence dynamique "tout le thread"). Idempotent sur rejeu identique (les deux familles comparées), refuse tout écrasement silencieux d''une résolution existante différente.';

-- ── 5. confirm_pending_trackability — guards 7/8 + label, étendus aux deux familles ─
-- Sens inchangé : evidence_status='resolved' reste la seule condition d'éligibilité
-- (guard 6, non modifié) ; jamais de dérivation depuis site_knowledge_proposals.status.

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
  -- famille historique uniquement, cf. doctrine en tête de fichier)
  SELECT site_id, canonical_subject_id INTO v_thread_site_id, v_canonical_subject_id
  FROM public.subject_thread_identity WHERE subject_thread_id = v_pending.source_thread_id;

  IF v_thread_site_id IS NOT NULL AND v_thread_site_id <> v_pending.site_id THEN
    RAISE EXCEPTION 'confirm_pending_trackability: ABORT — subject_thread_identity du thread (%) site_id=% différent du pending site_id=%',
      v_pending.source_thread_id, v_thread_site_id, v_pending.site_id;
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
  'Phase 6E.3B.2 + P0-1A-2a — confirme UNE pending trace TRACKABILITY_UNDETERMINED (evidence déjà figée par 394/408, historique et/ou native) en un nouveau tracked_point PROVISIONAL/founding_kind=manual + UNE membership HARD scope=proposal_set (jamais thread, jamais un scope dynamique). L''humain affirme l''existence d''une condition durable, jamais son état — derivedState reste entièrement produit par le réducteur. Revalidation live complète par famille (kind, status, evidence figée, non-collision, cross-site) ; idempotent sur rejeu identique via founding_source dédié ; RESOLUTION_WITHOUT_KNOWN_PROBLEM explicitement hors périmètre (ne fonde jamais son propre Point). Pilote HARD STOP : une seule pending trace par appel, aucun traitement en masse.';
