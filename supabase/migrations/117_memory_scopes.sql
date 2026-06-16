-- =============================================================================
-- 117 — Sprint 3 : NŒUDS DE MÉMOIRE (scopes).
--
-- Rend visible l'architecture d'adressage validée :
--   Organisation → Site → Scope → Contenu
-- Un « scope » = un sous-périmètre interrogeable d'un site (VRD, Réseau EP,
-- Électricité, Bâtiment B…). L'utilisateur ne voit JAMAIS le mot « scope » : il
-- voit le label (« VRD ») et, plus tard, le label de son type.
--
-- S3 MINIMAL (Vincent) : création / affichage / rattachement. PAS de récursion
-- profonde (parent_scope_id existe pour la profondeur future mais l'UI reste à
-- un niveau sous le site), PAS de recherche, PAS de LLM, PAS d'expérience.
--
-- Non destructif : `site_actions.scope_id` est une PRÉCISION en plus (nullable).
-- Le contenu non rattaché continue de vivre au niveau du site.
--
-- ⚠️ RAPPEL BLOQUANT : migration 114 (RLS enfants d'interventions) obligatoire
-- avant tout 2e tenant. Voir docs/PRE-MULTI-TENANT-CHECKLIST.md.
-- =============================================================================

-- 1. L'arbre de scopes (récursif par parent_scope_id, profondeur OPTIONNELLE).
create table if not exists public.memory_scopes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  site_id          uuid not null references public.sites(id) on delete cascade,
  -- NULL = nœud directement sous le site. Self-FK pour la profondeur future.
  parent_scope_id  uuid references public.memory_scopes(id) on delete cascade,
  -- Référence SOUPLE (pas de FK dure, cf. doctrine catalogue) vers
  -- org_catalog.key de kind ∈ {corps_etat, zone, objet}. NULL = label libre.
  -- C'est le futur axe d'agrégation TRANSVERSALE (« les VRD de tous mes sites »).
  scope_type_key   text,
  label            text not null,           -- affiché (« VRD », « Réseau EP »)
  description      text,
  active           boolean not null default true,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists idx_memory_scopes_site
  on public.memory_scopes(site_id) where deleted_at is null;
create index if not exists idx_memory_scopes_parent
  on public.memory_scopes(parent_scope_id) where deleted_at is null;
create index if not exists idx_memory_scopes_org_type
  on public.memory_scopes(organization_id, scope_type_key) where deleted_at is null;

-- 2. RLS : lecture scopée à l'org (défense en profondeur, cf. mig 114 / 115).
--    Écritures via service-role (server actions gardées) ; pas de policy write.
alter table public.memory_scopes enable row level security;
drop policy if exists "memory_scopes read" on public.memory_scopes;
create policy "memory_scopes read" on public.memory_scopes
  for select using (organization_id = public.current_user_org_id());

-- 3. RATTACHEMENT du contenu (S3 = on prouve la chaîne avec les actions).
--    Non destructif : nullable, on delete set null (supprimer un scope ne
--    supprime jamais le contenu, il le « dé-rattache » au niveau du site).
alter table public.site_actions
  add column if not exists scope_id uuid references public.memory_scopes(id) on delete set null;

create index if not exists idx_site_actions_scope
  on public.site_actions(scope_id) where scope_id is not null;
