-- =============================================================================
-- 132 — Colonne ACTION des points examinés (Vincent 2026-06-21) : « qui doit faire
-- quoi ». Codes responsables BECIB (ETV/MOA/MOE/FSH/CLUB), MULTI (ex. ETV/MOE).
--
-- STOCKÉ DANS LA MÉMOIRE du point (pas juste le PDF) → les prochains CR, la
-- recherche et les relances futures le retrouvent. Clé = (report, source du point :
-- action id / risk:reportId:i / anomalie id).
-- =============================================================================

create table if not exists public.report_point_actions (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.site_reports(id) on delete cascade,
  point_source text not null,
  codes        text[] not null default '{}', -- sous-ensemble de ETV/MOA/MOE/FSH/CLUB
  updated_at   timestamptz not null default now(),
  unique (report_id, point_source)
);
create index if not exists idx_report_point_actions_report on public.report_point_actions(report_id);

alter table public.report_point_actions enable row level security;
drop policy if exists "report_point_actions read" on public.report_point_actions;
create policy "report_point_actions read" on public.report_point_actions
  for select using (
    report_id in (
      select sr.id from public.site_reports sr
      join public.sites s on s.id = sr.site_id
      where s.organization_id = public.current_user_org_id()
    )
  );
