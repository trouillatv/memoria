-- =============================================================================
-- 128 — FONDATION d'apprentissage : lier la version GÉNÉRÉE par MemorIA à la
-- version FINALE diffusée par l'humain, pour comparer plus tard.
--
-- Vincent 2026-06-20 : le plus gros actif de MemorIA n'est pas le template, c'est
-- la matière « mémoire → version générée → version finale humaine ». On PRÉVOIT
-- dès maintenant la table de diff (elle reste VIDE aujourd'hui — aucune logique de
-- comparaison ni d'apprentissage ici). Niveau 2 = remplir `summary` (écarts :
-- participant/société/date/action ajoutés, reformulations). Niveau 3 = règles
-- candidates + validation humaine. JAMAIS d'apprentissage automatique.
--
-- generated = report_documents (archivé au « Archiver la version générée »).
-- final     = report_final_versions (téléversé, versionné, mig 127).
-- =============================================================================

create table if not exists public.document_diffs (
  id                            uuid primary key default gen_random_uuid(),
  report_id                     uuid not null references public.site_reports(id) on delete cascade,
  generated_report_document_id  uuid references public.report_documents(id) on delete set null,
  final_version_id              uuid references public.report_final_versions(id) on delete set null,
  summary                       jsonb, -- écarts détectés (NULL aujourd'hui ; rempli au Niveau 2)
  created_at                    timestamptz not null default now()
);

create index if not exists idx_document_diffs_report on public.document_diffs(report_id);

alter table public.document_diffs enable row level security;
drop policy if exists "document_diffs read" on public.document_diffs;
create policy "document_diffs read" on public.document_diffs
  for select using (
    report_id in (
      select sr.id from public.site_reports sr
      join public.sites s on s.id = sr.site_id
      where s.organization_id = public.current_user_org_id()
    )
  );
