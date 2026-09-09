-- Migration 399 : report temporel des pending traces (Phase 6E.8A)
--
-- GO explicite de Vincent après audit 6E.8 ("me le redemander plus tard" — verdict
-- ASK_LATER_MODEL_MISSING). Constat de l'audit : dismissPendingTrace (mig 390) est
-- aujourd'hui le SEUL geste de sortie de la file — le bouton "Laisser pour plus tard"
-- appelait la même action que "Non, ne pas suivre" (AssignResolutionCard), produisant
-- un dismissed permanent et silencieux indiscernable d'un rejet.
--
-- Décision d'architecture de Vincent : ne PAS introduire un nouvel état de cycle de vie
-- ('deferred') — status reste strictement dans {pending, resolved, dismissed} (mig 390).
-- Un report est une métadonnée additive posée sur une trace qui reste 'pending', jamais
-- un quatrième statut ni une seconde vérité de cycle de vie.
--
-- Visibilité : une pending trace status='pending' redevient visible dans toutes les
-- files qui la consomment dès que deferred_until est NULL OU déjà dans le passé — aucun
-- cron, aucun writer applicatif planifié, aucun LLM. La réapparition est une simple
-- conséquence de lecture au prochain chargement de file après l'échéance (mandat
-- Vincent : « un plus tard réellement vrai et simple plutôt qu'un faux moteur
-- intelligent de réveil »).
--
-- Hors périmètre explicite de cette migration (dette différée, jamais un TODO caché) :
-- aucun lien vers next_visit (6E.8B, aucun identifiant durable de "prochaine visite"
-- n'existe aujourd'hui pour qu'une question s'y rattache), aucune détection de
-- "nouvelle preuve depuis le report" (6E.8C — bloquée par l'absence de tout écrivain
-- vivant sur tracked_point_pending_trace, cf. mig 390 §RLS, jamais levée depuis).
--
-- Migration additive uniquement (aucun DROP, aucun changement de réducteur/projection,
-- aucune donnée écrite ici).

ALTER TABLE public.tracked_point_pending_trace
  ADD COLUMN IF NOT EXISTS deferred_until TIMESTAMPTZ;

ALTER TABLE public.tracked_point_pending_trace
  ADD COLUMN IF NOT EXISTS deferred_at TIMESTAMPTZ;

ALTER TABLE public.tracked_point_pending_trace
  ADD COLUMN IF NOT EXISTS deferred_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Cohérence intra-ligne : un report est toujours daté avec son échéance, jamais l'un
-- sans l'autre — même garantie que tracked_point_pending_trace_evidence_basis_consistency
-- (mig 394) et tracked_point_pending_trace_resolved_consistency (mig 390).
ALTER TABLE public.tracked_point_pending_trace
  ADD CONSTRAINT tracked_point_pending_trace_deferred_consistency
    CHECK ((deferred_until IS NULL) = (deferred_at IS NULL));
