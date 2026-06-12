-- Migration 089 — Multi-tenancy : table organizations + organization_id sur toutes les tables métier.
--
-- Stratégie :
--   1. Crée la table organizations (pivot multi-tenant).
--   2. Ajoute organization_id (nullable) sur toutes les tables racines et enfants.
--   3. Ajoute les index nécessaires.
--   4. Crée la fonction helper RLS current_user_org_id().
--   5. Met à jour les RLS policies pour inclure le filtre org (defense-in-depth).
--
-- Les valeurs organization_id sont remplies par le script scripts/dev/seed-orgs.ts
-- immédiatement après cette migration.

-- ============================================================
-- TABLE organizations
-- ============================================================
create table if not exists public.organizations (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  slug       text        unique,
  created_at timestamptz not null default now()
);

-- ============================================================
-- TABLES RACINES — ajout organization_id (users en premier, avant la fonction)
-- ============================================================
alter table public.users               add column if not exists organization_id uuid references public.organizations(id);

-- ============================================================
-- HELPER RLS : org de l'utilisateur authentifié courant
-- (créé après l'ajout de la colonne sur users)
-- ============================================================
create or replace function public.current_user_org_id()
  returns uuid
  language sql
  security definer
  stable
as $$
  select organization_id
  from   public.users
  where  id = auth.uid()
  limit  1
$$;
alter table public.clients             add column if not exists organization_id uuid references public.organizations(id);
alter table public.contracts           add column if not exists organization_id uuid references public.organizations(id);
alter table public.sites               add column if not exists organization_id uuid references public.organizations(id);
alter table public.teams               add column if not exists organization_id uuid references public.organizations(id);
alter table public.tenders             add column if not exists organization_id uuid references public.organizations(id);
alter table public.knowledge_items     add column if not exists organization_id uuid references public.organizations(id);
alter table public.documents           add column if not exists organization_id uuid references public.organizations(id);
alter table public.document_collections add column if not exists organization_id uuid references public.organizations(id);
alter table public.handover_briefs     add column if not exists organization_id uuid references public.organizations(id);
alter table public.reports             add column if not exists organization_id uuid references public.organizations(id);

-- ============================================================
-- TABLES ENFANTS (dénormalisé pour éviter les JOINs dans les requêtes chaudes)
-- ============================================================
alter table public.missions                  add column if not exists organization_id uuid references public.organizations(id);
alter table public.interventions             add column if not exists organization_id uuid references public.organizations(id);
alter table public.intervention_templates    add column if not exists organization_id uuid references public.organizations(id);
alter table public.team_members              add column if not exists organization_id uuid references public.organizations(id);
alter table public.knowledge_chunks          add column if not exists organization_id uuid references public.organizations(id);
alter table public.tender_analyses           add column if not exists organization_id uuid references public.organizations(id);
alter table public.tender_documents          add column if not exists organization_id uuid references public.organizations(id);
alter table public.tender_chat_messages      add column if not exists organization_id uuid references public.organizations(id);
alter table public.tender_chat_attachments   add column if not exists organization_id uuid references public.organizations(id);
alter table public.tender_agent_analyses     add column if not exists organization_id uuid references public.organizations(id);
alter table public.tender_conversations      add column if not exists organization_id uuid references public.organizations(id);
alter table public.engagements               add column if not exists organization_id uuid references public.organizations(id);
alter table public.proof_share_tokens        add column if not exists organization_id uuid references public.organizations(id);
alter table public.site_notes                add column if not exists organization_id uuid references public.organizations(id);
alter table public.site_reading_candidates   add column if not exists organization_id uuid references public.organizations(id);
alter table public.ai_usage                  add column if not exists organization_id uuid references public.organizations(id);
alter table public.activity_logs             add column if not exists organization_id uuid references public.organizations(id);

-- ============================================================
-- INDEX sur organization_id (toutes les tables qui en ont une)
-- ============================================================
create index if not exists idx_users_org                    on public.users(organization_id);
create index if not exists idx_clients_org                  on public.clients(organization_id);
create index if not exists idx_contracts_org                on public.contracts(organization_id);
create index if not exists idx_sites_org                    on public.sites(organization_id);
create index if not exists idx_teams_org                    on public.teams(organization_id);
create index if not exists idx_tenders_org                  on public.tenders(organization_id);
create index if not exists idx_knowledge_items_org          on public.knowledge_items(organization_id);
create index if not exists idx_documents_org                on public.documents(organization_id);
create index if not exists idx_document_collections_org     on public.document_collections(organization_id);
create index if not exists idx_handover_briefs_org          on public.handover_briefs(organization_id);
create index if not exists idx_missions_org                 on public.missions(organization_id);
create index if not exists idx_interventions_org            on public.interventions(organization_id);
create index if not exists idx_intervention_templates_org   on public.intervention_templates(organization_id);
create index if not exists idx_team_members_org             on public.team_members(organization_id);
create index if not exists idx_knowledge_chunks_org         on public.knowledge_chunks(organization_id);
create index if not exists idx_tender_analyses_org          on public.tender_analyses(organization_id);
create index if not exists idx_tender_documents_org         on public.tender_documents(organization_id);
create index if not exists idx_tender_chat_messages_org     on public.tender_chat_messages(organization_id);
create index if not exists idx_engagements_org              on public.engagements(organization_id);
create index if not exists idx_proof_share_tokens_org       on public.proof_share_tokens(organization_id);
create index if not exists idx_site_notes_org               on public.site_notes(organization_id);
create index if not exists idx_site_reading_candidates_org  on public.site_reading_candidates(organization_id);
create index if not exists idx_ai_usage_org                 on public.ai_usage(organization_id);
create index if not exists idx_activity_logs_org            on public.activity_logs(organization_id);

-- ============================================================
-- RLS — mise à jour des policies pour inclure le filtre org_id
-- (Defense-in-depth : le service_role passe par-dessus, mais
--  les server clients JWT sont contraints par org_id.)
-- ============================================================

-- clients
drop policy if exists "clients authenticated read" on public.clients;
drop policy if exists "clients org read"            on public.clients;
create policy "clients org read" on public.clients
  for select using (
    organization_id = public.current_user_org_id()
    and auth.role() = 'authenticated'
  );

drop policy if exists "clients manager admin write" on public.clients;
drop policy if exists "clients org manager admin write" on public.clients;
create policy "clients org manager admin write" on public.clients
  for all using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );

-- contracts (RLS absente dans 011 → on crée)
alter table public.contracts enable row level security;
drop policy if exists "contracts org read"  on public.contracts;
create policy "contracts org read" on public.contracts
  for select using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );
drop policy if exists "contracts org write" on public.contracts;
create policy "contracts org write" on public.contracts
  for all using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );

-- sites (remplace les deux policies de 011 + 038)
drop policy if exists "sites authenticated read"    on public.sites;
drop policy if exists "sites authorized read"       on public.sites;
drop policy if exists "sites org read"              on public.sites;
create policy "sites org read" on public.sites
  for select using (
    organization_id = public.current_user_org_id()
    and (
      public.current_user_role() in ('admin', 'manager')
      or exists (
        select 1
        from   public.missions m
        join   public.interventions i on i.mission_id = m.id
        where  m.site_id = sites.id
          and  m.deleted_at is null
          and  auth.uid() = any(i.team)
      )
    )
  );
drop policy if exists "sites manager admin write"       on public.sites;
drop policy if exists "sites org manager admin write"   on public.sites;
create policy "sites org manager admin write" on public.sites
  for all using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );

-- teams
alter table public.teams enable row level security;
drop policy if exists "teams authenticated read"  on public.teams;
drop policy if exists "teams org read"            on public.teams;
create policy "teams org read" on public.teams
  for select using (
    organization_id = public.current_user_org_id()
    and auth.role() = 'authenticated'
  );
drop policy if exists "teams manager admin write" on public.teams;
drop policy if exists "teams org manager write"   on public.teams;
create policy "teams org manager write" on public.teams
  for all using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );

-- missions (assigned_to retiré dans migration ultérieure — on garde role seul)
drop policy if exists "missions visible by role"     on public.missions;
drop policy if exists "missions org visible"         on public.missions;
create policy "missions org visible" on public.missions
  for select using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );
drop policy if exists "missions manager admin write" on public.missions;
drop policy if exists "missions assignee update"     on public.missions;
drop policy if exists "missions org manager write"   on public.missions;
drop policy if exists "missions org assignee update" on public.missions;
create policy "missions org manager write" on public.missions
  for all using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );

-- interventions
drop policy if exists "interventions authorized read"     on public.interventions;
drop policy if exists "interventions org authorized read" on public.interventions;
create policy "interventions org authorized read" on public.interventions
  for select using (
    organization_id = public.current_user_org_id()
    and (
      public.current_user_role() in ('admin', 'manager')
      or auth.uid() = any(team)
    )
  );

-- tenders
drop policy if exists "tenders manager admin all"   on public.tenders;
drop policy if exists "tenders org manager admin"   on public.tenders;
create policy "tenders org manager admin" on public.tenders
  for all using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );

-- knowledge_items
drop policy if exists "knowledge manager admin all"   on public.knowledge_items;
drop policy if exists "knowledge org manager admin"   on public.knowledge_items;
create policy "knowledge org manager admin" on public.knowledge_items
  for all using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );

-- documents + document_collections
alter table public.documents             enable row level security;
alter table public.document_collections  enable row level security;
drop policy if exists "documents org read"  on public.documents;
create policy "documents org read" on public.documents
  for select using (
    organization_id = public.current_user_org_id()
    and auth.role() = 'authenticated'
  );
drop policy if exists "documents org write" on public.documents;
create policy "documents org write" on public.documents
  for all using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );
drop policy if exists "document_collections org read" on public.document_collections;
create policy "document_collections org read" on public.document_collections
  for select using (
    organization_id = public.current_user_org_id()
    and auth.role() = 'authenticated'
  );
drop policy if exists "document_collections org write" on public.document_collections;
create policy "document_collections org write" on public.document_collections
  for all using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );

-- handover_briefs
alter table public.handover_briefs enable row level security;
drop policy if exists "handover_briefs org read"  on public.handover_briefs;
create policy "handover_briefs org read" on public.handover_briefs
  for select using (
    organization_id = public.current_user_org_id()
    and auth.role() = 'authenticated'
  );
drop policy if exists "handover_briefs org write" on public.handover_briefs;
create policy "handover_briefs org write" on public.handover_briefs
  for all using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  )
  with check (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );

-- ai_usage
drop policy if exists "ai_usage admin read"     on public.ai_usage;
drop policy if exists "ai_usage org admin read" on public.ai_usage;
create policy "ai_usage org admin read" on public.ai_usage
  for select using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() = 'admin'
  );

-- activity_logs
drop policy if exists "activity_logs admin manager read"     on public.activity_logs;
drop policy if exists "activity_logs org admin manager read" on public.activity_logs;
create policy "activity_logs org admin manager read" on public.activity_logs
  for select using (
    organization_id = public.current_user_org_id()
    and public.current_user_role() in ('admin', 'manager')
  );
