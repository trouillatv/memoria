-- =============================================================================
-- 129 — PRÉSENTATION des photos dans le CR (Vincent 2026-06-20) :
--   ① ORDRE des photos (le conducteur raconte une histoire : photo 1, 2, 3…)
--   ② PHOTO PRINCIPALE (couverture : 1ʳᵉ du PDF / miniature du CR)
--   ③ COMMENTAIRE GÉNÉRAL des photos (« avancement conforme malgré un retard… »)
--
-- Métadonnées de PRÉSENTATION propres à CE CR (pas à la photo elle-même : la même
-- photo peut servir ailleurs). On ne touche jamais intervention_photos/site_actions.
-- =============================================================================

-- ①② Par photo, pour ce CR.
create table if not exists public.report_photo_meta (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.site_reports(id) on delete cascade,
  photo_id    text not null, -- id de l'intervention_photo OU du site_action (selon source)
  source      text not null check (source in ('intervention', 'action')),
  sort_order  int  not null default 0,
  is_cover    boolean not null default false,
  updated_at  timestamptz not null default now(),
  unique (report_id, photo_id)
);
create index if not exists idx_report_photo_meta_report on public.report_photo_meta(report_id);

-- ③ Par CR : textes éditoriaux libres (commentaire général photos pour l'instant).
create table if not exists public.report_cr_meta (
  report_id       uuid primary key references public.site_reports(id) on delete cascade,
  photos_comment  text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.users(id) on delete set null
);

-- RLS : lecture scopée org via le site de la réunion (écritures = service-role).
alter table public.report_photo_meta enable row level security;
drop policy if exists "report_photo_meta read" on public.report_photo_meta;
create policy "report_photo_meta read" on public.report_photo_meta
  for select using (
    report_id in (
      select sr.id from public.site_reports sr
      join public.sites s on s.id = sr.site_id
      where s.organization_id = public.current_user_org_id()
    )
  );

alter table public.report_cr_meta enable row level security;
drop policy if exists "report_cr_meta read" on public.report_cr_meta;
create policy "report_cr_meta read" on public.report_cr_meta
  for select using (
    report_id in (
      select sr.id from public.site_reports sr
      join public.sites s on s.id = sr.site_id
      where s.organization_id = public.current_user_org_id()
    )
  );
