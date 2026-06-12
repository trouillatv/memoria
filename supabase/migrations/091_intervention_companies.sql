-- ============================================================================
-- Migration 091 — intervention_companies
-- ============================================================================
--
-- Trace les ENTREPRISES EXTERNES (sous-traitants, fournisseurs, prestataires)
-- présentes sur une intervention.
--
-- Doctrine : on ne stocke PAS des individus ici — uniquement des entités
-- commerciales (raison sociale). Permet de répondre "quelle entreprise a
-- installé ça ?" des années plus tard, sans stocker de données personnelles.
--
-- Exemples de company_name : "Menuiserie Dupont", "Électricité du Sud",
--                              "Livraison Matériaux Express".
-- Exemples de role_description : "Menuiserie", "Pose sol", "Livraison matériel".
--
-- Ce n'est PAS intervention_participants (qui stocke des users internes).

-- ----------------------------------------------------------------------------
-- 1) Table
-- ----------------------------------------------------------------------------

create table public.intervention_companies (
  id               uuid        primary key default gen_random_uuid(),
  intervention_id  uuid        not null references public.interventions(id) on delete cascade,
  company_name     text        not null check (char_length(trim(company_name)) >= 1),
  role_description text,
  created_at       timestamptz not null default now(),
  created_by       uuid        references public.users(id) on delete set null,
  organization_id  uuid        references public.organizations(id) on delete cascade
);

comment on table public.intervention_companies is
  'Entreprises externes (sous-traitants, fournisseurs) intervenant sur un chantier. '
  'Entités commerciales uniquement — jamais des individus (cf. intervention_participants). '
  'Permet de répondre "quelle entreprise a installé ceci ?" des années après l''intervention.';

comment on column public.intervention_companies.company_name is
  'Raison sociale de l''entreprise. Texte libre, au moins 1 caractère non-vide.';

comment on column public.intervention_companies.role_description is
  'Nature de l''intervention de cette entreprise : "Menuiserie", "Livraison matériel", '
  '"Électricité", etc. Facultatif mais recommandé pour la mémoire opérationnelle.';

-- ----------------------------------------------------------------------------
-- 2) Index
-- ----------------------------------------------------------------------------

create index idx_intervention_companies_intervention_id
  on public.intervention_companies(intervention_id);

create index idx_intervention_companies_org
  on public.intervention_companies(organization_id);

-- ----------------------------------------------------------------------------
-- 3) RLS
-- ----------------------------------------------------------------------------

alter table public.intervention_companies enable row level security;

-- SELECT : admin/manager voient tout dans leur org.
--          chef_equipe voit les entreprises des interventions dont il est
--          membre d'équipe (helper is_team_member_of_intervention déjà défini
--          dans migration 024).
create policy ic_select on public.intervention_companies
  for select using (
    organization_id = public.current_user_org_id()
    and (
      public.current_user_role() in ('admin', 'manager')
      or public.is_team_member_of_intervention(intervention_id)
    )
  );

-- INSERT : admin/manager uniquement. created_by doit être l'utilisateur courant.
create policy ic_insert on public.intervention_companies
  for insert with check (
    public.current_user_role() in ('admin', 'manager')
    and created_by = auth.uid()
  );

-- DELETE : admin/manager uniquement.
create policy ic_delete on public.intervention_companies
  for delete using (
    public.current_user_role() in ('admin', 'manager')
    and organization_id = public.current_user_org_id()
  );
