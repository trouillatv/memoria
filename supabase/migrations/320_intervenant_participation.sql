-- 320 — P0-3A : L'INTERVENANT DEVIENT UNE PARTICIPATION (conception Vincent 2026-08-14).
--
-- Doctrine des 4 niveaux de connaissance : mention brute → rôle identifié →
-- organisation identifiée → personne identifiée. Un intervenant de chantier
-- n'est PAS une entité : c'est une PARTICIPATION contextualisée
-- (acteur? × chantier × entreprise? × rôle × période).
--
-- Les QUATRE états deviennent légaux :
--   contact NULL  · company NULL  → « l'électricien » (rôle seul, non résolu)
--   contact Jean  · company NULL  → on connaît Jean, société inconnue
--   contact NULL  · company EEC   → EEC intervient, personne inconnue
--   contact Jean  · company EEC   → connaissance complète
--
-- VOLONTAIREMENT ABSENTE : une contrainte « au moins contact OU company ».
-- Elle interdirait précisément le niveau 2 (rôle seul), qui est un état
-- légitime et important — forcer une identité trop tôt abîme la mémoire.
--
-- Le chaînage s'appelle replaced_by_intervenant_id, PAS superseded_by :
-- « la participation de Jean dans ce rôle a été remplacée » — Jean, lui,
-- n'est jamais obsolète ; son passage reste vrai historiquement
-- (effective_from/effective_to demeurent la vérité temporelle principale).

-- 1. Le rôle seul devient représentable : company_id nullable.
alter table public.site_intervenants
  alter column company_id drop not null;

-- 2. Chaînage de remplacement de participation (Jean → Paul, même rôle).
alter table public.site_intervenants
  add column if not exists replaced_by_intervenant_id uuid
    references public.site_intervenants(id) on delete set null,
  add column if not exists replaced_at timestamptz;

comment on column public.site_intervenants.replaced_by_intervenant_id is
  'Participation qui remplace celle-ci dans le même rôle (Paul reprend le rôle de Jean). La clôture reste portée par effective_to.';

-- 3. L'ancienne unicité (site, role, company) ne correspond plus au métier :
--    une même entreprise peut avoir successivement — voire simultanément —
--    plusieurs personnes dans le même rôle. L'identité réelle est la ligne.
--    On n'empêche que les doublons ACTIFS strictement identiques ; on ne
--    représente JAMAIS la temporalité par une contrainte UNIQUE.
alter table public.site_intervenants
  drop constraint if exists site_intervenants_site_id_role_company_id_key;

-- La mig 138 avait déjà remplacé cette contrainte par un index partiel
-- (site, role, company) WHERE actif — il bloque encore les successions et le
-- multi-personnes simultané d'une même entreprise dans un même rôle. Il est
-- remplacé par l'identité complète ci-dessous (qui inclut le contact).
drop index if exists public.uq_site_intervenants_active;

create unique index if not exists site_intervenants_active_identity_uniq
  on public.site_intervenants (
    site_id,
    role,
    coalesce(company_id,      '00000000-0000-0000-0000-000000000000'),
    coalesce(main_contact_id, '00000000-0000-0000-0000-000000000000')
  )
  where effective_to is null;

create index if not exists site_intervenants_replaced_by_idx
  on public.site_intervenants (replaced_by_intervenant_id)
  where replaced_by_intervenant_id is not null;
