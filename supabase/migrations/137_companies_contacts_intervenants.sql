-- =============================================================================
-- 137 — QUI EST QUI sur un chantier (Vincent 2026-06-21). Aujourd'hui les rôles
-- (ETV/MOA/MOE/BET…) vivent en chaîne libre partout. On structure le graphe :
--
--   ROLE (sur CE site)  →  ORGANISME (réutilisable)  →  CONTACT (personne)
--   ETV                 →  BatiSud                    →  Jean Dupont · tel · mail
--
-- Modèle 3 tables NORMALISÉ (validé) : le rôle vit dans le LIEN site↔entreprise
-- (une même entreprise = ETV ici, sous-traitant ailleurs), jamais dans companies.
-- Champs riches dès maintenant (évite une refonte quand MemorIA générera 10 types
-- de docs). BRANDING documentaire (pied de page/signature) VOLONTAIREMENT EXCLU →
-- futur `organization_branding` (BatiSud peut être intervenant ET org propriétaire).
-- =============================================================================

-- 1) ORGANISMES intervenants — réutilisables dans tout l'org MemorIA.
create table if not exists public.companies (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name            text not null,
  short_name      text,
  logo_url        text,          -- logo de L'ENTREPRISE (≠ branding documentaire de l'org)
  siret           text,
  address         text,
  postal_code     text,
  city            text,
  country         text,
  phone           text,
  email           text,
  website         text,
  notes           text,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists idx_companies_org on public.companies(organization_id) where deleted_at is null;

-- 2) CONTACTS — les personnes d'une entreprise.
create table if not exists public.company_contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  full_name   text not null,
  function    text,              -- ex. « Conducteur de travaux »
  email       text,
  phone       text,
  mobile      text,
  is_main     boolean not null default false,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists idx_company_contacts_company on public.company_contacts(company_id) where deleted_at is null;

-- 3) CASTING DU CHANTIER — le mapping PAR SITE (le cœur). Le rôle est ici.
create table if not exists public.site_intervenants (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.sites(id) on delete cascade,
  role            text not null,     -- ETV/MOA/MOE/BET/FSH/CLUB… (libre : varie selon métier)
  company_id      uuid not null references public.companies(id) on delete cascade,
  main_contact_id uuid references public.company_contacts(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (site_id, role, company_id) -- co-traitance possible (N entreprises/rôle) mais pas de doublon exact
);
create index if not exists idx_site_intervenants_site on public.site_intervenants(site_id);

-- 4) DÉCISION → ACTION (Vincent P1) : une décision engendre souvent une action.
--    Champ posé maintenant (évite la dette) ; l'UI de liaison viendra après.
alter table public.site_decisions
  add column if not exists action_id uuid references public.site_actions(id) on delete set null;

-- RLS lecture (scope org) ---------------------------------------------------
alter table public.companies enable row level security;
drop policy if exists "companies read" on public.companies;
create policy "companies read" on public.companies
  for select using (organization_id = public.current_user_org_id());

alter table public.company_contacts enable row level security;
drop policy if exists "company_contacts read" on public.company_contacts;
create policy "company_contacts read" on public.company_contacts
  for select using (
    company_id in (select id from public.companies where organization_id = public.current_user_org_id())
  );

alter table public.site_intervenants enable row level security;
drop policy if exists "site_intervenants read" on public.site_intervenants;
create policy "site_intervenants read" on public.site_intervenants
  for select using (
    site_id in (select id from public.sites where organization_id = public.current_user_org_id())
  );
