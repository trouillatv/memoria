-- =============================================================================
-- 130 — POINTS HUMAINS ajoutés au CR (Vincent 2026-06-20).
--
-- MemorIA génère depuis la mémoire. Mais Émeline doit pouvoir AJOUTER une remarque
-- qui n'existe nulle part ailleurs (« La société X s'engage à transmettre le DOE
-- avant vendredi. »). Texte libre humain, rattaché à une SECTION du CR. C'est un
-- AJOUT (pas une correction de la mémoire structurée) → table dédiée par CR.
-- =============================================================================

create table if not exists public.report_human_points (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.site_reports(id) on delete cascade,
  section     text not null check (section in ('ordre_du_jour', 'points_examines', 'avancement', 'previsions', 'securite')),
  text        text not null,
  sort_order  int  not null default 0,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_report_human_points_report on public.report_human_points(report_id);

alter table public.report_human_points enable row level security;
drop policy if exists "report_human_points read" on public.report_human_points;
create policy "report_human_points read" on public.report_human_points
  for select using (
    report_id in (
      select sr.id from public.site_reports sr
      join public.sites s on s.id = sr.site_id
      where s.organization_id = public.current_user_org_id()
    )
  );
