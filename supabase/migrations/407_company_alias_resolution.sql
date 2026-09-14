-- 407 — Résolution d'identité entreprise : alias léger, jamais de fusion physique
-- (mandat Vincent 2026-09-14, Lot 2A Intervenants — audit Clim Exp'Air/Clim'Expair/
-- Pacific Froid Clim, cf. mémoire lot-intervenants-audit-lot1). Même gabarit que le
-- merge de tracked_point (mig 388 : status + merged_into_id) : une entreprise
-- « alias » pointe vers son entreprise canonique mais reste sa propre ligne — aucune
-- réécriture des FK existantes (site_intervenants.company_id, site_actions.
-- assigned_company_id, contact_company_affiliations.company_id, canonical_subject.
-- company_id… continuent de référencer l'id d'origine, l'historique n'est jamais
-- réécrit). La consolidation de lecture (Lot 2B) résout le canonique au moment de
-- l'agrégation ; aucune fusion physique tant qu'un audit multi-sites n'a pas validé
-- le mécanisme (Vincent : « consolidation de lecture ≠ fusion destructive »).

alter table public.companies
  add column if not exists status text not null default 'active'
    check (status in ('active', 'alias')),
  add column if not exists alias_of_company_id uuid
    references public.companies(id) on delete restrict;

alter table public.companies
  add constraint companies_alias_consistency
    check ((status = 'alias') = (alias_of_company_id is not null));

alter table public.companies
  add constraint companies_alias_not_self
    check (alias_of_company_id is null or alias_of_company_id <> id);

create index if not exists idx_companies_alias_of
  on public.companies (alias_of_company_id) where alias_of_company_id is not null;

comment on column public.companies.status is
  'active = entreprise canonique normale. alias = cette ligne ne doit plus être utilisée comme identité propre, cf. alias_of_company_id. Jamais de suppression : les FK existantes vers cette ligne restent valides et lisibles (historique).';
comment on column public.companies.alias_of_company_id is
  'Entreprise canonique dont celle-ci est un doublon de nom (mandat Vincent 2026-09-14). Renseigné ⟺ status=''alias''. Décision humaine explicite, jamais un rapprochement automatique/fuzzy.';

-- Un alias ne peut jamais pointer vers une autre entreprise elle-même alias (pas de
-- chaîne à résoudre) ni vers une entreprise d'une autre organisation. Un CHECK ne
-- peut pas lire une autre ligne : trigger requis.
create or replace function public.check_company_alias_target()
returns trigger language plpgsql as $$
declare
  target_status text;
  target_org uuid;
begin
  if new.alias_of_company_id is null then
    return new;
  end if;
  select status, organization_id into target_status, target_org
    from public.companies where id = new.alias_of_company_id;
  if target_status is null then
    raise exception 'alias_of_company_id introuvable';
  end if;
  if target_status = 'alias' then
    raise exception 'Une entreprise alias ne peut pas pointer vers une autre entreprise alias (pas de chaîne).';
  end if;
  if target_org is distinct from new.organization_id then
    raise exception 'Une entreprise alias doit pointer vers une entreprise de la même organisation.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_company_alias_target on public.companies;
create trigger trg_check_company_alias_target
  before insert or update of alias_of_company_id, status on public.companies
  for each row execute function public.check_company_alias_target();
