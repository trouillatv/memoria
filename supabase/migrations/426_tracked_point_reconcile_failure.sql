-- P0-A (mandat Vincent, suite REVIEW du 2026-09-21) — filet de second niveau pour
-- reconcileTrackedPointMutationBestEffort (lib/db/tracked-point-live-writer-mutation-adapter.ts).
--
-- Constat de la review : "best-effort" ne persistait rien en cas d'échec (refus RPC ou
-- exception) — la panne était seulement journalisée (console.error), sans trace durable ni
-- rejeu. Une mutation CBO correctement écrite pouvait donc laisser un thread jamais réévalué,
-- exactement la famille de défaut que P0-A visait à fermer (root cause A). Aucun mécanisme
-- périodique existant ne repêchait ce cas précis : sweep-stuck-reconciliation (P0
-- RECONCILIATION-RELIABILITY, 2026-08-24) couvre un étage différent du pipeline
-- (site_reports.canonical_reconciled_at, PV → sujet canonique), pas le Live Writer.
--
-- Cette table journalise, par mutation (entity_type, entity_id, canonical_business_object_id),
-- la DERNIÈRE tentative échouée — jamais un historique complet (une ligne par échec ferait
-- grossir la table sans bénéfice : seul l'état "encore à rejouer" compte pour le sweep).
-- Additif : aucune table existante modifiée.

CREATE TABLE public.tracked_point_reconcile_failure (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                     UUID        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  entity_type                 TEXT        NOT NULL CHECK (entity_type IN ('site_action', 'site_reserve', 'site_deadline')),
  entity_id                   UUID        NOT NULL,
  canonical_business_object_id UUID       NOT NULL REFERENCES public.canonical_business_object(id) ON DELETE CASCADE,
  error                       TEXT        NOT NULL,
  attempt_count               INTEGER     NOT NULL DEFAULT 1,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at                 TIMESTAMPTZ
);

-- Une mutation retentée plusieurs fois avant résolution met à jour la MÊME ligne (upsert) —
-- jamais de doublon pour le même (entity_type, entity_id, cbo).
CREATE UNIQUE INDEX tracked_point_reconcile_failure_entity_cbo_key
  ON public.tracked_point_reconcile_failure (entity_type, entity_id, canonical_business_object_id);

-- Requête du sweep : lignes non résolues, triées par ancienneté de dernière tentative.
CREATE INDEX ON public.tracked_point_reconcile_failure (last_attempt_at) WHERE resolved_at IS NULL;

ALTER TABLE public.tracked_point_reconcile_failure ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view tracked_point_reconcile_failure"
  ON public.tracked_point_reconcile_failure FOR SELECT
  USING (
    site_id IN (
      SELECT s.id FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "service role manages tracked_point_reconcile_failure"
  ON public.tracked_point_reconcile_failure FOR ALL
  USING (auth.role() = 'service_role');
