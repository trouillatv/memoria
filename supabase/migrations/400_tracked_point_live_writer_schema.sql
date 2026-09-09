-- Migration 400 : schéma du Live Writer P6 (tracked_point)
--
-- Renumérotée 399→400 (Round 2) : la branche feat/p6-live-writer avait divergé
-- de main avant l'intégration de 6E.8A, qui possède déjà la vraie migration 399
-- (399_tracked_point_pending_trace_defer.sql). Cette migration est rejouée sur
-- une branche fraîche depuis origin/main pour éviter toute collision de numéro.
--
-- Contrat frozen : docs/tracked-points/p6-live-writer-design.md. Cette migration NE
-- CRÉE AUCUNE ÉCRITURE AUTOMATIQUE — elle pose seulement les garanties de schéma que
-- le RPC de la migration 401 (fn_reconcile_tracked_point_unit) doit pouvoir supposer
-- vraies AVANT d'écrire quoi que ce soit. Design §4 (5 invariants DB), §2.6 (state/
-- event/artifact), §2.7 (unicité de fondation).
--
-- Réserve NON LEVÉE par cette migration (§2.7, §8 du design) : avant toute
-- APPLICATION réelle, confirmer `SELECT count(*) FROM tracked_point WHERE
-- founding_reference IS NULL` — si ce compte est > 0, l'index partiel ci-dessous
-- reste correct techniquement (WHERE founding_reference IS NOT NULL l'exclut) mais
-- la couverture réelle de l'invariant 1 doit être revérifiée avant GO APPLY. Un
-- préflight READ-ONLY est exécuté sur la base cible réelle dans ce lot (Round 2,
-- item 13) — voir rapport HARD STOP pour le résultat.
--
-- NO GO APPLY — cette migration n'est pas appliquée par ce lot (mandat explicite).

-- ── Invariant 1 (§2.7) : une identité de fondation ne peut produire qu'un Point ──
--
-- founding_kind='cbo'                → founding_reference = canonical_business_object.id
-- founding_kind='trackable_condition' → founding_reference = subject_thread_id (ou
--                                        subject_thread_id#proposalSetOf pour un
--                                        founding scope=proposal_set — même convention
--                                        que unit_key ci-dessous, lib/knowledge/
--                                        tracked-point-write-plan.ts:foundingReferenceOf)
-- founding_kind='manual'             → founding_reference = pending_trace_id (mig 395)

CREATE UNIQUE INDEX tracked_point_founding_identity_uidx
  ON public.tracked_point (site_id, founding_kind, founding_reference)
  WHERE founding_reference IS NOT NULL;

-- ── Invariant 2 (§4) : membership HARD scope='proposal_set' — pas de doublon exact ──
--
-- Complète tracked_point_member_active_thread_uidx (mig 388), qui ne couvre que
-- scope='thread'. Deux lignes actives portant EXACTEMENT le même
-- (subject_thread_id, proposal_ids) ne peuvent coexister — n'empêche jamais deux
-- sous-ensembles DIFFÉRENTS du même thread de pointer vers des Points distincts
-- (c'est le mécanisme de correction de drift documenté mig 388).

CREATE UNIQUE INDEX tracked_point_member_active_proposal_set_uidx
  ON public.tracked_point_member (subject_thread_id, proposal_ids)
  WHERE status = 'active' AND scope = 'proposal_set';

-- ── Invariant 4 (§4) : une candidate pending équivalente ne peut exister qu'une fois ──

CREATE UNIQUE INDEX tracked_point_identity_candidate_pending_uidx
  ON public.tracked_point_identity_candidate (candidate_point_id, subject_thread_id, scope)
  WHERE status = 'pending';

-- ── State / Event / Artifact (§2.6) ─────────────────────────────────────────────
--
-- unit_key : même convention que foundingReferenceOf (lib/knowledge/
-- tracked-point-write-plan.ts) — threadId seul pour scope='thread',
-- '<threadId>#<proposalSetOf>' pour scope='proposal_set'. Pas une FK : les threads
-- n'ont pas de table dédiée (même convention que subject_thread_identity, mig 279).

-- tracked_point_reconcile_state : une ligne COURANTE par (site_id, unit_key),
-- UPSERT à chaque tentative. Sert au rejeu rapide (§2.5) — jamais la source de
-- vérité de l'historique, voir reconcile_event ci-dessous.
CREATE TABLE public.tracked_point_reconcile_state (
  site_id          UUID        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  unit_key         TEXT        NOT NULL,
  input_fingerprint TEXT       NOT NULL,
  verdict          TEXT        NOT NULL
                      CHECK (verdict IN ('AUTO_CREATED', 'AUTO_LINKED', 'NEEDS_HUMAN', 'IGNORED_NOT_TRACKABLE')),
  write_pattern    TEXT        NOT NULL
                      CHECK (write_pattern IN (
                        'CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK', 'CREATE_POINT_WITH_MEMBERSHIP',
                        'ATTACH_MEMBER', 'ENRICH_EXISTING_POINT',
                        'CREATE_PENDING_TRACE', 'CREATE_CANDIDATES', 'NOOP', 'IGNORE_NOT_TRACKABLE'
                      )),
  target_point_id  UUID        REFERENCES public.tracked_point(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, unit_key)
);

-- tracked_point_reconcile_event : append-only, une ligne par TENTATIVE (y compris
-- les rejeux NOOP et les transitions needs_human → auto_linked qu'un simple UPSERT
-- détruirait). input_snapshot en clair pour diagnostic humain (§2.5) — jamais
-- reconstruit depuis input_fingerprint (hash à sens unique).
CREATE TABLE public.tracked_point_reconcile_event (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  unit_key          TEXT        NOT NULL,
  input_fingerprint TEXT        NOT NULL,
  input_snapshot    JSONB       NOT NULL,
  verdict           TEXT        NOT NULL
                       CHECK (verdict IN ('AUTO_CREATED', 'AUTO_LINKED', 'NEEDS_HUMAN', 'IGNORED_NOT_TRACKABLE')),
  write_pattern     TEXT        NOT NULL
                       CHECK (write_pattern IN (
                         'CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK', 'CREATE_POINT_WITH_MEMBERSHIP',
                         'ATTACH_MEMBER', 'ENRICH_EXISTING_POINT',
                         'CREATE_PENDING_TRACE', 'CREATE_CANDIDATES', 'NOOP', 'IGNORE_NOT_TRACKABLE'
                       )),
  target_point_id   UUID        REFERENCES public.tracked_point(id) ON DELETE SET NULL,
  replayed          BOOLEAN     NOT NULL DEFAULT false,
  -- Provenance (§6) : source_kind/source_ref_id, même convention que
  -- canonical_subject_occurrence (mig 398). historical_pdf → source_ref_id =
  -- documents.id (source_document_id, alignement 398/317, PAS extraction_run_id).
  -- field_visit → source_ref_id = site_reports.id.
  source_kind       TEXT        NOT NULL
                       CHECK (source_kind IN ('historical_pdf', 'field_visit', 'meeting')),
  source_ref_id     UUID,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON public.tracked_point_reconcile_event (site_id, unit_key);
CREATE INDEX ON public.tracked_point_reconcile_event (target_point_id);

-- tracked_point_reconcile_artifact : enfant de reconcile_event. Référence UNIQUEMENT
-- ce que CETTE tentative a effectivement créé ou modifié (jamais un artefact
-- préexistant retrouvé et réutilisé sans modification — witness 16, §2.6).
CREATE TABLE public.tracked_point_reconcile_artifact (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconcile_event_id  UUID NOT NULL REFERENCES public.tracked_point_reconcile_event(id) ON DELETE CASCADE,
  artifact_kind       TEXT NOT NULL
                         CHECK (artifact_kind IN (
                           'tracked_point', 'tracked_point_member', 'tracked_point_pending_trace',
                           'tracked_point_identity_candidate', 'canonical_business_object'
                         )),
  artifact_id         UUID NOT NULL
);

CREATE INDEX ON public.tracked_point_reconcile_artifact (reconcile_event_id);

-- ── RLS — même pattern que mig 388/390 (org members SELECT, service_role ALL) ──

ALTER TABLE public.tracked_point_reconcile_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracked_point_reconcile_event     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracked_point_reconcile_artifact  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view tracked_point_reconcile_state"
  ON public.tracked_point_reconcile_state FOR SELECT
  USING (
    site_id IN (
      SELECT s.id FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "org members can view tracked_point_reconcile_event"
  ON public.tracked_point_reconcile_event FOR SELECT
  USING (
    site_id IN (
      SELECT s.id FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "org members can view tracked_point_reconcile_artifact"
  ON public.tracked_point_reconcile_artifact FOR SELECT
  USING (
    reconcile_event_id IN (
      SELECT e.id FROM public.tracked_point_reconcile_event e
      JOIN public.sites s ON s.id = e.site_id
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "service role manages tracked_point_reconcile_state"
  ON public.tracked_point_reconcile_state FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service role manages tracked_point_reconcile_event"
  ON public.tracked_point_reconcile_event FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service role manages tracked_point_reconcile_artifact"
  ON public.tracked_point_reconcile_artifact FOR ALL
  USING (auth.role() = 'service_role');
