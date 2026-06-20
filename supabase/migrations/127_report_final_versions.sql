-- =============================================================================
-- 127 — VERSIONS de la version finale diffusée (jamais « remplacer », on EMPILE).
--
-- Un document diffusé est une PREUVE : on ne l'écrase pas. Chaque téléversement
-- crée une nouvelle version (v1, v2, v3…) horodatée, avec une note de diffusion
-- optionnelle (« envoyé à 18 destinataires », « diffusion hebdo chantier »).
-- C'est l'HISTORIQUE DOCUMENTAIRE de la réunion (traçabilité chantier).
-- Vincent 2026-06-20. La mig 126 (report_documents.final_*) reste le pointeur
-- « dernière version » (dénormalisé, pour l'affichage rapide).
-- =============================================================================

create table if not exists public.report_final_versions (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references public.site_reports(id) on delete cascade,
  version_no    int  not null,
  document_id   uuid references public.documents(id) on delete set null,
  path          text not null,
  format        text not null check (format in ('pdf', 'docx')),
  note          text, -- note de diffusion / destinataires (optionnel)
  finalized_by  uuid references public.users(id) on delete set null,
  finalized_at  timestamptz not null default now(),
  unique (report_id, version_no)
);

create index if not exists idx_report_final_versions_report on public.report_final_versions(report_id);

-- RLS : lecture scopée org via le site de la réunion (écritures = service-role).
alter table public.report_final_versions enable row level security;
drop policy if exists "report_final_versions read" on public.report_final_versions;
create policy "report_final_versions read" on public.report_final_versions
  for select using (
    report_id in (
      select sr.id from public.site_reports sr
      join public.sites s on s.id = sr.site_id
      where s.organization_id = public.current_user_org_id()
    )
  );
