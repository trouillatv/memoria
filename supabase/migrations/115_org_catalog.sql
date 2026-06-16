-- =============================================================================
-- 115 — Sprint 2-B : fondation du CATALOGUE de vocabulaire par organisation.
--
-- Rend le vocabulaire (catégories d'anomalie, spécialités d'équipe, et plus tard
-- corps d'état / objets / zones) PARAMÉTRABLE PAR ORGANISATION → MemorIA s'adapte
-- au métier (cleaning / construction / maintenance / generic / …).
--
-- DÉCISION V1 (Vincent) : UNE SEULE TABLE. Les futurs `scope_types` seront les
-- entrées de `org_catalog` de kind ∈ {corps_etat, objet, zone}. Pas de table
-- séparée tant qu'un besoin réel ne l'exige pas.
--
-- Non destructif : la lecture applicative fait un FALLBACK sur le template du
-- métier de l'org tant que le catalogue n'est pas seedé → zéro changement de
-- comportement. Les orgs EXISTANTES sont mises à 'cleaning' (l'app est nettoyage
-- aujourd'hui) pour conserver exactement les libellés actuels.
--
-- ⚠️ RAPPEL BLOQUANT : la migration 114 (RLS org-scope des tables enfants
-- d'interventions) reste OBLIGATOIRE avant tout 2e tenant / vraie démo
-- multi-tenant. Voir docs/PRE-MULTI-TENANT-CHECKLIST.md.
-- =============================================================================

-- 1. Métier de l'organisation. Défaut 'generic' (neutre) ; l'existant → 'cleaning'.
alter table public.organizations
  add column if not exists industry_template text not null default 'generic';

update public.organizations set industry_template = 'cleaning'
  where industry_template = 'generic';

-- 2. Catalogue de vocabulaire (table unique extensible).
create table if not exists public.org_catalog (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null,   -- 'anomaly_category' | 'team_specialty' | 'corps_etat' | 'objet' | 'zone' | …
  key             text not null,   -- machine-stable, JAMAIS affiché
  label           text not null,   -- affiché, personnalisable
  description     text,
  icon            text,
  color           text,
  sort_order      int  not null default 0,
  active          boolean not null default true,
  metadata        jsonb not null default '{}'::jsonb,  -- attributs spécifiques au kind (ex. {"severity":"critique"})
  created_at      timestamptz not null default now(),
  unique (organization_id, kind, key)
);

create index if not exists idx_org_catalog_org_kind
  on public.org_catalog(organization_id, kind) where active;

-- 3. RLS : lecture scopée à l'org (défense en profondeur — cf. mig 114).
--    Écritures via service-role (seed / admin) ; pas de policy write client en V1.
alter table public.org_catalog enable row level security;
drop policy if exists "org_catalog read" on public.org_catalog;
create policy "org_catalog read" on public.org_catalog
  for select using (organization_id = public.current_user_org_id());
