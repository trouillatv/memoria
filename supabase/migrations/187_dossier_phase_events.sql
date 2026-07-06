-- 187 — Journal des transitions de phase du dossier (jalons de la frise).
--
-- Pour que la frise raconte une HISTOIRE (« Passé en appel d'offres », « Marché
-- remporté », « Chantier archivé »), il faut la DATE réelle de chaque transition.
-- Aujourd'hui seul `dossiers.phase` (+ updated_at) existe : impossible de dater
-- une transition passée sans l'inventer. On journalise donc les changements de
-- phase À PARTIR DE MAINTENANT (les transitions futures deviennent des jalons
-- datés, réels ; le passé reste tel quel — zéro donnée inventée).

create table if not exists public.dossier_phase_events (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  phase text not null,
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_dossier_phase_events_site
  on public.dossier_phase_events (site_id, at desc);
