-- =============================================================================
-- 118 — Sprint 3 (suite) : rattacher les ANOMALIES aux nœuds de mémoire.
--
-- Après les actions (mig 117), on branche le 2e contenu sur les scopes → le
-- nœud devient « vivant » : « VRD → 15 actions · 8 anomalies ». Même mécanisme,
-- non destructif (nullable, on delete set null).
--
-- Pré-requis : mig 114 (organization_id sur intervention_anomalies) + mig 117
-- (memory_scopes). L'anomalie est reliée au site via son intervention.
-- =============================================================================

alter table public.intervention_anomalies
  add column if not exists scope_id uuid references public.memory_scopes(id) on delete set null;

create index if not exists idx_intervention_anomalies_scope
  on public.intervention_anomalies(scope_id) where scope_id is not null;
