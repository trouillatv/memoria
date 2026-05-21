-- ===========================================================
-- Migration 080 — intervention_anomalies.resolved_by (Vincent 2026-05-22)
--
-- Sprint D — Mémoire qui sait vieillir.
--
-- Contexte : la table intervention_anomalies a déjà (migration 018) :
--   - status anomaly_status DEFAULT 'open' (open / resolved / ignored)
--   - resolved_at timestamptz
--   - resolution_note text
--
-- Ce qui manque pour la philosophie de l'oubli :
--   - resolved_by uuid : QUI a marqué résolu (audit + responsabilité)
--
-- Pas de migration des anomalies existantes — toutes restent 'open'
-- par défaut. Les managers résoudront au fil de l'eau via l'UI
-- nouvelle (Sprint D ou variante).
--
-- IDEMPOTENT.
-- ===========================================================

alter table public.intervention_anomalies
  add column if not exists resolved_by uuid references public.users(id) on delete set null;

comment on column public.intervention_anomalies.resolved_by is
  'Vincent 2026-05-22 — Qui a marqué cette anomalie comme résolue. NULL si status=open. Sert au filtrage de la mémoire vive dans les briefs de passage de témoin (sprint D — philosophie-de-loubli).';

-- Index partiel pour filtrer rapidement les anomalies actives (sprint D)
create index if not exists idx_intervention_anomalies_open
  on public.intervention_anomalies(intervention_id, created_at desc)
  where status = 'open';
