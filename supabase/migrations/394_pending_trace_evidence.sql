-- Migration 394 : PENDING EVIDENCE PERSISTENCE (Phase 6E.3B.1)
--
-- GO explicite de Vincent après clôture de la réconciliation du ledger de migrations
-- (356-393, 40/40 tracked, 0 drift). Décision d'architecture de Vincent, en écart avec
-- ce qui avait été envisagé plus tôt : whole_thread N'EST JAMAIS persisté comme un
-- périmètre dynamique/vivant — un thread peut recevoir de nouvelles propositions plus
-- tard, ce qui contaminerait rétroactivement une décision prise aujourd'hui. Les IDs de
-- proposition exacts sont donc TOUJOURS figés au moment de la persistance, y compris
-- pour les lignes WHOLE_THREAD_PROVEN_SAFE (6E.3A.1) où toutes les propositions du
-- thread sont actuellement prouvées sûres.
--
-- Split conceptuel volontaire (le savoir "la portée est connue" ≠ "comment elle a été
-- déterminée") :
--   evidence_status  ∈ {unresolved, resolved}         — la portée de preuve est-elle connue ?
--   evidence_basis   ∈ {exact_single_proposal,          — comment a-t-elle été déterminée ?
--                        whole_thread_proven_safe,
--                        human_selected, NULL}
--   Règle : unresolved → basis NULL ; resolved → basis NOT NULL.
--
-- tracked_point_pending_trace_evidence (nouvelle table, jointure normalisée plutôt
-- qu'un uuid[]) : FK réelle vers document_extraction_proposal (intégrité référentielle,
-- dédoublonnage par PK, extension triviale future vers human_selected multi-propositions
-- — un tableau ne donne aucune de ces trois garanties gratuitement).
--
-- La colonne existante source_proposal_id (migration 390) n'est ni dépréciée ni une
-- deuxième vérité : elle reste un pointeur informatif ponctuel. La nouvelle table
-- d'evidence devient la provenance précise de référence pour ce workflow.
--
-- Invariant absolu : ce lot reste ENTIÈREMENT hors de la "vérité Point" — 0 effet sur
-- tracked_point_member, le réducteur, derivedState, la trajectoire, identity_candidate.
-- C'est une couche provenance/workflow ("quelle preuve serait utilisée si un humain
-- décidait d'agir plus tard"), jamais un mécanisme d'identité. Aucun réducteur ni
-- projection ne lit cette table dans ce lot.
--
-- Migration additive uniquement (aucun DROP, aucun changement de réducteur). Schéma +
-- writer/triggers seulement — le backfill des 433 lignes existantes est une opération de
-- données séparée, exécutée après ce schéma via le RPC ci-dessous (jamais par écriture
-- SQL directe), sur la base des classifications déjà auditées (6E.3A / 6E.3A.1).

-- ── 1. Colonnes de provenance sur tracked_point_pending_trace ──────────────────────

ALTER TABLE public.tracked_point_pending_trace
  ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (evidence_status IN ('unresolved', 'resolved'));

ALTER TABLE public.tracked_point_pending_trace
  ADD COLUMN IF NOT EXISTS evidence_basis TEXT
    CHECK (evidence_basis IS NULL OR evidence_basis IN (
      'exact_single_proposal', 'whole_thread_proven_safe', 'human_selected'
    ));

-- Cohérence intra-ligne : basis renseigné si et seulement si status='resolved'.
-- (Ne dit RIEN sur l'existence réelle de lignes d'evidence — invariant cross-table,
-- cf. triggers §4.)
ALTER TABLE public.tracked_point_pending_trace
  ADD CONSTRAINT tracked_point_pending_trace_evidence_basis_consistency
    CHECK ((evidence_status = 'unresolved') = (evidence_basis IS NULL));

-- ── 2. Table d'evidence normalisée ──────────────────────────────────────────────────

CREATE TABLE public.tracked_point_pending_trace_evidence (
  pending_trace_id UUID        NOT NULL REFERENCES public.tracked_point_pending_trace(id) ON DELETE CASCADE,
  proposal_id      UUID        NOT NULL REFERENCES public.document_extraction_proposal(id) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pending_trace_id, proposal_id)
);

CREATE INDEX ON public.tracked_point_pending_trace_evidence (proposal_id);

-- ── 3. Garde de cohérence de thread (immédiate, non différée) ──────────────────────
-- Une FK seule ne garantit pas que proposal_id appartient au source_thread_id du
-- pending — exigence explicite de Vincent. Vérifié à l'insertion/mise à jour, pas
-- recalculable après coup : une proposition d'un AUTRE thread ne doit jamais pouvoir
-- devenir la preuve d'une pending trace.

CREATE OR REPLACE FUNCTION public.tracked_point_pending_trace_evidence_thread_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_pending_thread_id  UUID;
  v_proposal_thread_id UUID;
BEGIN
  SELECT source_thread_id INTO v_pending_thread_id
  FROM public.tracked_point_pending_trace WHERE id = NEW.pending_trace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tracked_point_pending_trace_evidence: pending_trace_id % introuvable', NEW.pending_trace_id;
  END IF;

  SELECT subject_thread_id INTO v_proposal_thread_id
  FROM public.document_extraction_proposal WHERE id = NEW.proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tracked_point_pending_trace_evidence: proposal_id % introuvable', NEW.proposal_id;
  END IF;

  IF v_proposal_thread_id IS DISTINCT FROM v_pending_thread_id THEN
    RAISE EXCEPTION 'tracked_point_pending_trace_evidence: proposal % (thread %) n''appartient pas au thread de la pending trace % (thread %)',
      NEW.proposal_id, v_proposal_thread_id, NEW.pending_trace_id, v_pending_thread_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tracked_point_pending_trace_evidence_thread_guard
  BEFORE INSERT OR UPDATE ON public.tracked_point_pending_trace_evidence
  FOR EACH ROW EXECUTE FUNCTION public.tracked_point_pending_trace_evidence_thread_guard();

-- ── 4. Cohérence cross-table evidence_status ↔ existence de lignes d'evidence ──────
-- resolved doit avoir ≥1 ligne d'evidence ; unresolved doit en avoir 0. Un CHECK
-- ordinaire ne peut pas porter sur deux tables — CONSTRAINT TRIGGER différé pour
-- laisser une transaction multi-instructions (update parent + inserts enfants, ordre
-- quelconque) se terminer avant l'évaluation, tout en couvrant aussi une opération
-- autocommitée à une seule instruction.

CREATE OR REPLACE FUNCTION public.tracked_point_pending_trace_evidence_consistency_check(p_pending_trace_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_status         TEXT;
  v_evidence_count INT;
BEGIN
  SELECT evidence_status INTO v_status
  FROM public.tracked_point_pending_trace WHERE id = p_pending_trace_id;
  IF NOT FOUND THEN
    RETURN; -- ligne parente supprimée entretemps (CASCADE) : rien à vérifier
  END IF;

  SELECT count(*) INTO v_evidence_count
  FROM public.tracked_point_pending_trace_evidence WHERE pending_trace_id = p_pending_trace_id;

  IF v_status = 'resolved' AND v_evidence_count = 0 THEN
    RAISE EXCEPTION 'tracked_point_pending_trace %: evidence_status=resolved mais 0 ligne evidence', p_pending_trace_id;
  END IF;

  IF v_status = 'unresolved' AND v_evidence_count > 0 THEN
    RAISE EXCEPTION 'tracked_point_pending_trace %: evidence_status=unresolved mais % ligne(s) evidence présente(s)', p_pending_trace_id, v_evidence_count;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_pending_trace_evidence_consistency_from_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.tracked_point_pending_trace_evidence_consistency_check(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_pending_trace_evidence_consistency_parent
  AFTER UPDATE OF evidence_status, evidence_basis ON public.tracked_point_pending_trace
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_pending_trace_evidence_consistency_from_parent();

CREATE OR REPLACE FUNCTION public.trg_pending_trace_evidence_consistency_from_child()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.tracked_point_pending_trace_evidence_consistency_check(OLD.pending_trace_id);
  ELSE
    PERFORM public.tracked_point_pending_trace_evidence_consistency_check(NEW.pending_trace_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_pending_trace_evidence_consistency_child
  AFTER INSERT OR UPDATE OR DELETE ON public.tracked_point_pending_trace_evidence
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_pending_trace_evidence_consistency_from_child();

-- ── 5. Writer atomique unique ───────────────────────────────────────────────────────
-- Seul chemin sanctionné pour résoudre une pending trace. Idempotent : rejouer avec
-- exactement le même jeu de preuves est un no-op ; rejouer avec un jeu différent sur
-- une trace déjà résolue est refusé (jamais d'écrasement silencieux).

CREATE OR REPLACE FUNCTION public.resolve_pending_trace_evidence(
  p_pending_trace_id UUID,
  p_proposal_ids     UUID[],
  p_evidence_basis   TEXT
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending         public.tracked_point_pending_trace%ROWTYPE;
  v_proposal_id     UUID;
  v_existing_ids    UUID[];
  v_requested_ids   UUID[];
  v_inserted_count  INT := 0;
BEGIN
  IF p_evidence_basis IS NULL OR p_evidence_basis NOT IN ('exact_single_proposal', 'whole_thread_proven_safe', 'human_selected') THEN
    RAISE EXCEPTION 'resolve_pending_trace_evidence: evidence_basis invalide (%)', p_evidence_basis;
  END IF;

  IF p_proposal_ids IS NULL OR array_length(p_proposal_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'resolve_pending_trace_evidence: p_proposal_ids vide — au moins une proposition attendue';
  END IF;

  SELECT * INTO v_pending FROM public.tracked_point_pending_trace WHERE id = p_pending_trace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolve_pending_trace_evidence: pending trace introuvable (%)', p_pending_trace_id;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_requested_ids FROM unnest(p_proposal_ids) AS x;

  IF v_pending.evidence_status = 'resolved' THEN
    SELECT array_agg(proposal_id ORDER BY proposal_id) INTO v_existing_ids
    FROM public.tracked_point_pending_trace_evidence WHERE pending_trace_id = p_pending_trace_id;

    IF v_pending.evidence_basis = p_evidence_basis AND v_existing_ids = v_requested_ids THEN
      RETURN jsonb_build_object(
        'pendingTraceId', p_pending_trace_id,
        'result', 'already_resolved',
        'evidenceCount', COALESCE(array_length(v_existing_ids, 1), 0)
      );
    END IF;

    RAISE EXCEPTION 'resolve_pending_trace_evidence: pending trace % déjà résolue avec un jeu de preuves différent (basis=%, proposals=%)',
      p_pending_trace_id, v_pending.evidence_basis, v_existing_ids;
  END IF;

  FOREACH v_proposal_id IN ARRAY v_requested_ids LOOP
    INSERT INTO public.tracked_point_pending_trace_evidence (pending_trace_id, proposal_id)
    VALUES (p_pending_trace_id, v_proposal_id)
    ON CONFLICT (pending_trace_id, proposal_id) DO NOTHING;
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

COMMENT ON FUNCTION public.resolve_pending_trace_evidence(UUID, UUID[], TEXT) IS
  'Phase 6E.3B.1 — seul chemin sanctionné pour résoudre la provenance d''une pending trace : fige un jeu exact de proposal_id (jamais une référence dynamique "tout le thread") avec sa base de détermination. Idempotent sur rejeu identique, refuse tout écrasement silencieux d''une résolution existante différente.';

-- ── 6. RLS ───────────────────────────────────────────────────────────────────────
-- Même pattern que 388/389/390 : lecture org-scopée (via jointure au site de la
-- pending trace parente), écriture réservée au service_role.

ALTER TABLE public.tracked_point_pending_trace_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view tracked_point_pending_trace_evidence"
  ON public.tracked_point_pending_trace_evidence FOR SELECT
  USING (
    pending_trace_id IN (
      SELECT tpt.id FROM public.tracked_point_pending_trace tpt
      JOIN public.sites s ON s.id = tpt.site_id
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "service role manages tracked_point_pending_trace_evidence"
  ON public.tracked_point_pending_trace_evidence FOR ALL
  USING (auth.role() = 'service_role');
