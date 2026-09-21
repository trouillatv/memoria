-- P0-B1 (mandat Vincent, suite audit P0-B du 2026-09-21) — filet de résilience pour
-- reconcileSubjectThreads() (lib/documents/subject-reconciliation.ts), appelée à l'étape 12 de
-- l'extraction historique (lib/documents/extract-historical-pv.ts).
--
-- Constat P0-B (audit READ-ONLY) : l'étape 12 encapsule reconcileSubjectThreads() dans un
-- try/catch non bloquant — toute exception était seulement journalisée (console.error), jamais
-- persistée ni rejouée. Le run continuait, restait ready_for_review, et les propositions
-- concernées gardaient subject_thread_id = NULL indéfiniment, invisibles au resolver CBO
-- (fetchViaHistoricalChain) et donc au Live Writer. La reproduction contrôlée (document
-- 98978e97-34fe-4d56-afd4-371f4fd0c029) n'a pas permis de reconstituer la cause exacte de
-- l'échec historique (le même calcul réussit aujourd'hui sur les mêmes données) — la cause
-- exacte reste donc délibérément non invoquée ici. Le défaut de résilience, lui, est prouvé et
-- indépendant de cette cause : Vincent a arbitré la fiabilisation de l'étape pour l'avenir
-- (persistance + rejeu), sans backfill des cas historiques (hors périmètre, cf. P0-B2 séparé).
--
-- Cette table journalise, par run d'extraction, la DERNIÈRE tentative échouée de
-- reconcileSubjectThreads — jamais un historique complet (même doctrine que
-- tracked_point_reconcile_failure, migration 426). reconcileSubjectThreads() opère par run
-- (pas par entité), la clé naturelle est donc extraction_run_id seul.
-- Additif : aucune table existante modifiée.

CREATE TABLE public.subject_thread_reconcile_failure (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_run_id  UUID        NOT NULL REFERENCES public.document_extraction_run(id) ON DELETE CASCADE,
  site_id            UUID        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  error              TEXT        NOT NULL,
  attempt_count      INTEGER     NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at        TIMESTAMPTZ
);

-- Un run rejoué plusieurs fois avant résolution met à jour la MÊME ligne (upsert) — jamais de
-- doublon pour le même extraction_run_id.
CREATE UNIQUE INDEX subject_thread_reconcile_failure_run_key
  ON public.subject_thread_reconcile_failure (extraction_run_id);

-- Requête du sweep : lignes non résolues, triées par ancienneté de dernière tentative.
CREATE INDEX ON public.subject_thread_reconcile_failure (last_attempt_at) WHERE resolved_at IS NULL;

ALTER TABLE public.subject_thread_reconcile_failure ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view subject_thread_reconcile_failure"
  ON public.subject_thread_reconcile_failure FOR SELECT
  USING (
    site_id IN (
      SELECT s.id FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "service role manages subject_thread_reconcile_failure"
  ON public.subject_thread_reconcile_failure FOR ALL
  USING (auth.role() = 'service_role');
