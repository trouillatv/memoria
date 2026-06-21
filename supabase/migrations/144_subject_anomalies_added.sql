-- =============================================================================
-- 144 — COMPLÉTER LE FIL DU SUJET (Vincent 2026-06-21, P3A). Pour que « Pourquoi
-- c'est encore ouvert ? » reste crédible, le sujet doit absorber TOUTE son histoire :
-- décisions (143) + actions/réserves (124) + ANOMALIES + POINTS AJOUTÉS en séance.
-- Une anomalie non résolue rattachée à un sujet = une vraie CAUSE de blocage
-- (« Façade Nord : infiltration, fissure » au lieu de « cause : ? »).
-- =============================================================================

alter table public.intervention_anomalies
  add column if not exists subject_id uuid references public.subjects(id) on delete set null;
create index if not exists idx_anomalies_subject on public.intervention_anomalies(subject_id);

alter table public.report_added_points
  add column if not exists subject_id uuid references public.subjects(id) on delete set null;
create index if not exists idx_added_points_subject on public.report_added_points(subject_id);
