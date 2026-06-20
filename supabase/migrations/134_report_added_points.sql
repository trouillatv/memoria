-- =============================================================================
-- 134 — Points STRUCTURÉS ajoutés en séance (Vincent 2026-06-21) : « ajouter une
-- anomalie », « ajouter une prévision structurée ». Reconstruction manuelle du PV :
-- Émeline saisit un objet TYPÉ (pas du texte libre — ça, c'est report_human_points)
-- même si aucune remontée terrain ne l'a produit.
--
-- MÉMORISÉ (clé = report) → réutilisé CR suivant / recherche / relances. Ajout
-- éditorial local au CR → vraie suppression autorisée (≠ artefact terrain).
--   kind='anomalie'  → Points examinés (blocage « ANOMALIES SIGNALÉES EN SÉANCE »),
--                      `statut` = avancement, `label` = description.
--   kind='prevision' → Prévisions, `label` + `assigned_to` + `due_date` (structuré).
-- =============================================================================

create table if not exists public.report_added_points (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.site_reports(id) on delete cascade,
  kind         text not null check (kind in ('anomalie', 'prevision')),
  label        text not null,
  statut       text,                 -- anomalie : 'bloqué' | 'en cours' | 'à faire' | 'en attente'
  due_date     date,                 -- prévision : échéance
  assigned_to  text,                 -- prévision : responsable (texte libre, jamais nominatif interne)
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_report_added_points_report on public.report_added_points(report_id);

alter table public.report_added_points enable row level security;
drop policy if exists "report_added_points read" on public.report_added_points;
create policy "report_added_points read" on public.report_added_points
  for select using (
    report_id in (
      select sr.id from public.site_reports sr
      join public.sites s on s.id = sr.site_id
      where s.organization_id = public.current_user_org_id()
    )
  );
