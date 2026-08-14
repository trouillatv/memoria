-- 321 — P0-3B : L'APPARTENANCE À UNE ENTREPRISE DEVIENT UNE RELATION TEMPORELLE.
--
-- (Conception Vincent 2026-08-14.) Une personne est une personne ; son
-- appartenance à une entreprise n'est PAS constitutive de son identité.
-- `company_contacts.company_id` faisait de Jean un « contact de EEC » : quand
-- Jean passait chez Electro NC, réécrire son company_id réécrivait
-- rétroactivement TOUS les liens historiques (scénario 9 de l'audit — le plus
-- bloquant). Désormais :
--
--   Jean Dupont → EEC        du 01/01/2025 au 30/06/2026
--   Jean Dupont → Electro NC à partir du 01/07/2026
--
-- et le passé ne change jamais.
--
-- MIGRATION PROGRESSIVE (pas de big bang) :
--   Étape 1 (CE fichier) : la table + backfill du company_id actuel comme
--     affiliation courante. `company_contacts.company_id` est CONSERVÉ pour
--     la compatibilité des lecteurs existants.
--   Étape 2 (code) : les nouvelles écritures passent par l'affiliation ;
--     company_id devient legacy/fallback, synchronisé pendant la transition.
--   Étape 3 (plus tard, une fois tous les lecteurs migrés) : dépréciation.
--
-- Le backfill n'INVENTE rien : effective_from reste NULL (date d'entrée
-- inconnue — on ne fabrique pas une fausse ancienneté).

create table if not exists public.contact_company_affiliations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  contact_id       uuid not null references public.company_contacts(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  effective_from   date,
  effective_to     date,
  /** L'affiliation à afficher par défaut quand plusieurs sont actives. */
  is_primary       boolean not null default true,
  created_at       timestamptz not null default now()
);

comment on table public.contact_company_affiliations is
  'Relation temporelle personne ↔ entreprise (P0-3B, 2026-08-14). L''identité de la personne vit dans company_contacts ; son appartenance vit ICI, datée. Le passé ne se réécrit jamais.';

-- Un seul lien ACTIF identique (la temporalité n'est pas une contrainte UNIQUE).
create unique index if not exists contact_company_affiliations_active_uniq
  on public.contact_company_affiliations (contact_id, company_id)
  where effective_to is null;

create index if not exists contact_company_affiliations_contact_idx
  on public.contact_company_affiliations (contact_id);
create index if not exists contact_company_affiliations_company_idx
  on public.contact_company_affiliations (company_id);

alter table public.contact_company_affiliations enable row level security;
drop policy if exists "contact_company_affiliations read" on public.contact_company_affiliations;
create policy "contact_company_affiliations read" on public.contact_company_affiliations
  for select using (organization_id = public.current_user_org_id());

-- Backfill : le company_id existant devient l'affiliation COURANTE.
insert into public.contact_company_affiliations (organization_id, contact_id, company_id)
select cc.organization_id, cc.id, cc.company_id
from public.company_contacts cc
where cc.company_id is not null
  and cc.deleted_at is null
  and not exists (
    select 1 from public.contact_company_affiliations a
    where a.contact_id = cc.id and a.company_id = cc.company_id and a.effective_to is null
  );
