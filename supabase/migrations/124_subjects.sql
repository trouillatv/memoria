-- =============================================================================
-- 124 — SUJETS VIVANTS : donner une forme durable aux fils qui reviennent
-- réunion après réunion (« le DOE », « les essais à la plaque », « la fissure
-- voile nord », « la réception VRD »).
--
-- Un sujet n'est PAS un conteneur qui duplique : c'est un FIL nommé qui pointe
-- vers actions / réserves / décisions / documents déjà existants. Il stabilise
-- la mémoire d'un problème sur plusieurs mois (ce que CRM/ERP/GED ne font pas).
--
-- Doctrine : un sujet = problème / ouvrage / livrable / point technique / fil
-- opérationnel. JAMAIS une personne (anti-RH). Statut open→dormant→closed
-- (philosophie de l'oubli). Léger : on rattache, on ne recrée pas.
-- =============================================================================

create table if not exists public.subjects (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  site_id          uuid not null references public.sites(id) on delete cascade,
  -- Sous-périmètre optionnel (VRD, Réseau EP…) — précision, jamais obligatoire.
  scope_id         uuid references public.memory_scopes(id) on delete set null,
  name             text not null,
  -- open = vivant · dormant = en sommeil · closed = clos. Manuel au MVP.
  status           text not null default 'open' check (status in ('open', 'dormant', 'closed')),
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_subjects_site on public.subjects(site_id) where status <> 'closed';
create index if not exists idx_subjects_org on public.subjects(organization_id);

-- RLS : lecture scopée org (défense en profondeur, cf. mig 114/117). Écritures
-- via service-role (server actions gardées).
alter table public.subjects enable row level security;
drop policy if exists "subjects read" on public.subjects;
create policy "subjects read" on public.subjects
  for select using (organization_id = public.current_user_org_id());

-- Rattachements : FK nullable on delete set null (supprimer un sujet ne supprime
-- jamais le contenu — il se « dé-rattache »). Même pattern que reserve_id (123).
alter table public.site_actions
  add column if not exists subject_id uuid references public.subjects(id) on delete set null;
create index if not exists idx_site_actions_subject on public.site_actions(subject_id) where subject_id is not null;

alter table public.site_reserve
  add column if not exists subject_id uuid references public.subjects(id) on delete set null;
create index if not exists idx_site_reserve_subject on public.site_reserve(subject_id) where subject_id is not null;

alter table public.site_report_proposals
  add column if not exists subject_id uuid references public.subjects(id) on delete set null;
create index if not exists idx_proposals_subject on public.site_report_proposals(subject_id) where subject_id is not null;

-- Documents ↔ sujet via document_links (réutilise l'infra). On étend le CHECK
-- (inclut déjà 'reserve' depuis la mig 123).
alter table public.document_links drop constraint if exists document_links_target_type_check;
alter table public.document_links add constraint document_links_target_type_check
  check (target_type in (
    'contract','site','tender','client','intervention','team','tenant','reserve','subject'));
