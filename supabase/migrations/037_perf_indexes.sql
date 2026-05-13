-- Migration 037 — Indexes performance.
--
-- Cible : éviter les seq scans sur les tables qui vont grossir
-- (interventions, intervention_photos, intervention_anomalies, missions).
-- Identifié par audit perf 2026-05-13 — bombes à retardement à 12-18 mois.
--
-- Toutes les commandes utilisent IF NOT EXISTS — migration idempotente,
-- sans risque sur la base existante.

-- 1. GIN sur missions.engagement_ids (utilisé dans .contains/.overlaps partout)
--    Le filtre partiel sur deleted_at IS NULL réduit la taille de l'index.
create index if not exists missions_engagement_ids_gin
  on public.missions using gin (engagement_ids)
  where deleted_at is null;

-- 2. GIN sur interventions.team (utilisé dans listInterventionsVisibleToUser)
create index if not exists interventions_team_gin
  on public.interventions using gin (team);

-- 3. B-tree sur interventions.executed_at — utilisé partout en filtres temporels
--    (dashboard, monthly-report, getRecentActivity, getContractContinuity).
create index if not exists interventions_executed_at_idx
  on public.interventions(executed_at desc nulls last)
  where executed_at is not null;

-- 4. B-tree sur interventions.created_at — utilisé dans admin-monitoring.
create index if not exists interventions_created_at_idx
  on public.interventions(created_at desc);

-- 5. B-tree sur intervention_photos.taken_at — monthly-report, monitoring.
create index if not exists intervention_photos_taken_at_idx
  on public.intervention_photos(taken_at desc);

-- 6. B-tree sur intervention_anomalies.resolved_at — dashboard, monthly-report.
create index if not exists intervention_anomalies_resolved_at_idx
  on public.intervention_anomalies(resolved_at desc)
  where resolved_at is not null;

-- 7. B-tree sur intervention_anomalies.created_at — admin-monitoring, dashboard.
create index if not exists intervention_anomalies_created_at_idx
  on public.intervention_anomalies(created_at desc);

-- 8. B-tree sur contracts.end_date — renewals dashboard et briefing.
create index if not exists contracts_end_date_idx
  on public.contracts(end_date)
  where status in ('active', 'paused') and deleted_at is null;

-- 9. Partial index intervention_photos par kind='anomaly' — proofs.ts:597.
create index if not exists intervention_photos_anomaly_idx
  on public.intervention_photos(intervention_id)
  where kind = 'anomaly';

-- 10. Unique partial sur engagements pour éviter les doublons d'IA.
create unique index if not exists engagements_tender_label_uniq
  on public.engagements (tender_id, lower(short_label))
  where status in ('extracted', 'curated', 'active');
