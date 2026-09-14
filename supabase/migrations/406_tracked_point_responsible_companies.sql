-- Promotion humaine explicite d'une entreprise CITÉE (détectée dans le titre ou les preuves
-- d'un Point, cf. computeCitedCompanies / PointDetailCitedCompany) en responsable structuré
-- de ce Point (mandat Vincent 2026-09-14, lot Entreprise citée → Responsable, cas Clim
-- Exp'Air). La détection textuelle ne crée jamais cette ligne : seul un clic humain explicite
-- (« Définir comme responsable ») écrit ici — jamais une promotion automatique.
--
-- Réversible : un retrait pose `revoked_at`/`revoked_by` plutôt que de supprimer la ligne
-- (même doctrine que tracked_point_pending_trace : la trace d'une décision passée n'est
-- jamais perdue). L'index unique est PARTIEL (WHERE revoked_at IS NULL) pour permettre une
-- re-désignation après un retrait, à la différence de tracked_point_reviews (405) dont
-- l'index est plein — ce table n'est donc jamais consommée via upsert/onConflict, toujours
-- par un check-then-insert explicite côté repository.
create table if not exists public.tracked_point_responsible_companies (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  site_id           uuid not null references public.sites(id) on delete cascade,
  tracked_point_id  uuid not null references public.tracked_point(id) on delete cascade,
  company_id        uuid not null references public.companies(id) on delete cascade,
  designated_by     uuid references public.users(id) on delete set null,
  designated_at     timestamptz not null default now(),
  revoked_at        timestamptz,
  revoked_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- Une entreprise ne peut être ACTIVEMENT désignée responsable qu'une seule fois par Point ;
-- un retrait (revoked_at posé) libère l'index pour une re-désignation ultérieure.
create unique index if not exists tracked_point_responsible_company_active_uidx
  on public.tracked_point_responsible_companies (tracked_point_id, company_id)
  where revoked_at is null;

create index if not exists tracked_point_responsible_company_lookup_idx
  on public.tracked_point_responsible_companies (tracked_point_id)
  where revoked_at is null;

comment on table public.tracked_point_responsible_companies is
  'Désignation humaine explicite d''une entreprise citée en responsable structuré d''un Point (mandat Vincent 2026-09-14). Jamais écrite par la détection textuelle elle-même.';
comment on column public.tracked_point_responsible_companies.revoked_at is
  'Non nul = désignation retirée par un geste humain. La ligne reste (trace), l''index unique partiel permet une re-désignation ultérieure de la même entreprise sur le même Point.';

alter table public.tracked_point_responsible_companies enable row level security;
drop policy if exists "service_role_full_access" on public.tracked_point_responsible_companies;
create policy "service_role_full_access" on public.tracked_point_responsible_companies
  for all using (auth.role() = 'service_role');
