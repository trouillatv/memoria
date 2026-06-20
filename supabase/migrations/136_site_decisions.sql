-- =============================================================================
-- 136 — DÉCISIONS de chantier (Vincent 2026-06-21) : l'objet le plus DURABLE d'un
-- CR. « On a décidé que… » — ni une action (chose à faire), ni une prévision
-- (projection), ni une anomalie (problème). Ce que le conducteur cherche 3 mois
-- après. MÉMOIRE DU SITE (≠ ajout éditorial scopé au CR : pas report_added_points).
--
-- Table dédiée calquée sur site_actions ; projetée dans le spine (PvValidationItem
-- type 'decision' → Points administratifs du CR). Une entité, N surfaces.
--
-- Cycle de vie (rend la mémoire vivante) :
--   proposée → actée → appliquée → caduque / contredite
-- Débloque (modèle structuré, pas un texte) : décisions non appliquées, décisions
-- contradictoires, décisions récurrentes, recherche mémoire, prépa réunion suivante.
-- =============================================================================

create table if not exists public.site_decisions (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references public.sites(id) on delete cascade,
  report_id          uuid references public.site_reports(id) on delete set null, -- CR d'origine (nullable : décision hors réunion future)
  titre              text not null,
  description        text,
  sujet              text,                 -- clé de cluster : contradiction / récurrence / recherche (« revêtement », « parking »)
  decisionnaire_role text,                 -- MOA/MOE/ETV/FSH/CLUB (réutilise ACTION_CODES)
  decisionnaire_org  text,                 -- organisme (modèle Sprint 2 prêt ; null pour l'instant)
  date_decision      date not null default current_date,
  echeance           date,                 -- date cible d'application si pertinente
  statut             text not null default 'actee'
                       check (statut in ('proposee', 'actee', 'appliquee', 'caduque', 'contredite')),
  impact             text check (impact in ('planning', 'cout', 'technique', 'securite', 'autre')),
  confiance          text not null default 'sûr' check (confiance in ('sûr', 'à confirmer')),
  source             text not null default 'human' check (source in ('meeting', 'transcript', 'human')),
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_site_decisions_site on public.site_decisions(site_id);
create index if not exists idx_site_decisions_report on public.site_decisions(report_id);
create index if not exists idx_site_decisions_sujet on public.site_decisions(site_id, sujet);

alter table public.site_decisions enable row level security;
drop policy if exists "site_decisions read" on public.site_decisions;
create policy "site_decisions read" on public.site_decisions
  for select using (
    site_id in (select id from public.sites where organization_id = public.current_user_org_id())
  );
