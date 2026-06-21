-- =============================================================================
-- 142 — RÉ-ANALYSE non destructive (Vincent 2026-06-21, P2b). Ferme la boucle audio :
-- audio complémentaire → corpus fusionné → RÉ-ANALYSE → nouveaux éléments à curer.
--
-- Décisions validées : historique LÉGER (deltas, pas de snapshot complet) ; dédup
-- DÉTERMINISTE (type + libellé normalisé, pas de LLM) ; jamais auto ; jamais
-- destructif (on conserve propositions existantes, acceptées/rejetées, participants).
-- Objectif : Émeline comprend en 5 s « ce que l'audio complémentaire a apporté ».
-- =============================================================================

-- Historique léger des analyses : une ligne par run, juste le DELTA.
create table if not exists public.report_analysis_runs (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.site_reports(id) on delete cascade,
  trigger      text not null default 'reanalysis' check (trigger in ('initial', 'reanalysis')),
  source_count integer,                 -- nb de sources audio au moment du run
  delta        jsonb,                   -- { newActions, newProposals, newParticipants, newRisks, byType:{…} }
  created_at   timestamptz not null default now()
);
create index if not exists idx_analysis_runs_report on public.report_analysis_runs(report_id);

alter table public.report_analysis_runs enable row level security;
drop policy if exists "report_analysis_runs read" on public.report_analysis_runs;
create policy "report_analysis_runs read" on public.report_analysis_runs
  for select using (
    report_id in (
      select sr.id from public.site_reports sr
      join public.sites s on s.id = sr.site_id
      where s.organization_id = public.current_user_org_id()
    )
  );

-- Tag d'ORIGINE des propositions : distinguer celles issues d'une ré-analyse.
alter table public.site_report_proposals
  add column if not exists origin text not null default 'initial'
    check (origin in ('initial', 'reanalysis'));
