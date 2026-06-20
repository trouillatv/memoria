-- =============================================================================
-- 138 — Sprint 2b « tissu connectif & mémoire » (Vincent 2026-06-21).
--
-- (a) HISTORIQUE DU CASTING (assurance mémoire, pas UI) : site_intervenants devient
--     TEMPOREL. On ne supprime plus un lien rôle→entreprise — on le CLÔTURE
--     (effective_to). « Qui était ETV au CR05 ? » redevient reconstituable même
--     plusieurs années après. source_report_id = le CR où le lien a été établi.
--
-- (b) DÉCISIONNAIRE = contact réel (P2) : site_decisions.decisionnaire_contact_id
--     (≠ le simple rôle/organisme). « Qui a décidé » = une personne, pas un code.
--     (decision→action existe déjà : site_decisions.action_id, mig 137.)
-- =============================================================================

-- (a) Temporalité du casting --------------------------------------------------
alter table public.site_intervenants
  add column if not exists effective_from   date not null default current_date,
  add column if not exists effective_to     date,                 -- null = lien ACTIF
  add column if not exists source_report_id uuid references public.site_reports(id) on delete set null;

-- L'ancien unique (site,role,company) bloquerait l'historique (réouverture d'un rôle).
-- On le remplace par un unique PARTIEL : un seul lien ACTIF par (site,role,company),
-- mais autant de liens CLÔTURÉS qu'on veut.
alter table public.site_intervenants
  drop constraint if exists site_intervenants_site_id_role_company_id_key;
create unique index if not exists uq_site_intervenants_active
  on public.site_intervenants(site_id, role, company_id) where effective_to is null;
create index if not exists idx_site_intervenants_history on public.site_intervenants(site_id, role, effective_from);

-- (b) Décisionnaire = contact réel --------------------------------------------
alter table public.site_decisions
  add column if not exists decisionnaire_contact_id uuid references public.company_contacts(id) on delete set null;
