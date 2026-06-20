-- =============================================================================
-- 133 — Photos AJOUTÉES directement au CR (Vincent 2026-06-21) : « ajouter une
-- photo ». Reconstruction manuelle complète du PV — Émeline peut joindre une photo
-- même si aucune intervention/action terrain ne l'a remontée.
--
-- DISTINCTION doctrinale (mémoire « artefact brut jamais supprimé ») :
--   - photos intervention/action = ARTEFACT TERRAIN → jamais supprimé, au plus
--     « exclu du PV » (réversible) ;
--   - photo report = AJOUT ÉDITORIAL local au CR → vraie suppression autorisée
--     (ce n'est pas une preuve terrain, c'est une illustration choisie).
-- Stockage : même bucket `intervention-photos`, préfixe `report/<reportId>/`.
-- =============================================================================

create table if not exists public.report_photos (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.site_reports(id) on delete cascade,
  storage_path text not null,
  caption      text,
  taken_at     timestamptz,           -- date de prise de vue (optionnelle)
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_report_photos_report on public.report_photos(report_id);

alter table public.report_photos enable row level security;
drop policy if exists "report_photos read" on public.report_photos;
create policy "report_photos read" on public.report_photos
  for select using (
    report_id in (
      select sr.id from public.site_reports sr
      join public.sites s on s.id = sr.site_id
      where s.organization_id = public.current_user_org_id()
    )
  );
