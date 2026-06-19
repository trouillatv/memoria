-- =============================================================================
-- 120 — Sprint 1 (PV chantier) : DOCUMENTS GÉNÉRÉS depuis une réunion.
--
-- Couche de GÉNÉRATION documentaire au-dessus de l'analyse de réunion existante
-- (site_reports → proposals/actions). On ne ré-extrait rien : on REMPLIT un
-- template (CR chantier) à partir d'une réunion déjà analysée, puis l'humain
-- édite par sections → valide → PDF → document de mémoire.
--
-- `sections` (jsonb) = SOURCE DE VÉRITÉ : [{ key, title, kind, content, sources }].
-- Le texte et le PDF se rendent DEPUIS sections (jamais l'inverse).
--
-- Choix A (Vincent) : la section « Actions » reflète les actions DÉJÀ curées de
-- la réunion (site_actions), jamais une extraction parallèle.
--
-- `document_id` : NULL tant que brouillon ; renseigné au moment du « Valider »
-- quand le PV figé est poussé dans /documents (mémoire interrogeable, cf. S5).
-- =============================================================================

create table if not exists public.report_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  report_id        uuid not null references public.site_reports(id) on delete cascade,
  -- Site concerné (réunion site) ; NULL possible pour une réunion contrat.
  site_id          uuid references public.sites(id) on delete set null,
  -- Clé de template résolue (compagnie → défaut). Ex. 'cr_chantier_vrd.v1'.
  template_key     text not null,
  -- Sections rendues, SOURCE DE VÉRITÉ. [{ key, title, kind, content, sources }].
  sections         jsonb not null default '[]'::jsonb,
  -- draft = éditable · validated = figé · exported = PDF produit/poussé en mémoire.
  status           text not null default 'draft'
                     check (status in ('draft', 'validated', 'exported')),
  -- Document de mémoire créé au « Valider » (NULL tant que brouillon).
  document_id      uuid references public.documents(id) on delete set null,
  pdf_path         text,
  provider         text,
  model            text,
  prompt_version   text,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_report_documents_report
  on public.report_documents(report_id);
create index if not exists idx_report_documents_site
  on public.report_documents(site_id) where site_id is not null;
create index if not exists idx_report_documents_org
  on public.report_documents(organization_id);

-- RLS : lecture scopée à l'org (défense en profondeur, cf. mig 114/115/117).
-- Écritures via service-role (server actions gardées) ; pas de policy write.
alter table public.report_documents enable row level security;
drop policy if exists "report_documents read" on public.report_documents;
create policy "report_documents read" on public.report_documents
  for select using (organization_id = public.current_user_org_id());
