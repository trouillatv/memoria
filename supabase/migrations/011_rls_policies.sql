-- RLS sur toutes les tables métier, avec patterns adaptés au rôle JWT

-- Helper function : récupère le rôle depuis le JWT app_metadata
create or replace function public.current_user_role()
  returns user_role
  language sql
  security definer
  stable
as $$
  select coalesce(
    (auth.jwt()->'app_metadata'->>'role')::user_role,
    'chef_equipe'::user_role
  )
$$;

-- ============================================================
-- users
-- ============================================================
alter table public.users enable row level security;

drop policy if exists "users self read" on public.users;
create policy "users self read" on public.users
  for select using (id = auth.uid() or public.current_user_role() in ('admin', 'manager'));

drop policy if exists "users admin manage" on public.users;
create policy "users admin manage" on public.users
  for all using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ============================================================
-- clients
-- ============================================================
alter table public.clients enable row level security;

drop policy if exists "clients authenticated read" on public.clients;
create policy "clients authenticated read" on public.clients
  for select using (auth.role() = 'authenticated');

drop policy if exists "clients manager admin write" on public.clients;
create policy "clients manager admin write" on public.clients
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- ============================================================
-- sites
-- ============================================================
alter table public.sites enable row level security;

drop policy if exists "sites authenticated read" on public.sites;
create policy "sites authenticated read" on public.sites
  for select using (auth.role() = 'authenticated');

drop policy if exists "sites manager admin write" on public.sites;
create policy "sites manager admin write" on public.sites
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- ============================================================
-- missions
-- ============================================================
alter table public.missions enable row level security;

-- chef_equipe voit ses missions, manager/admin voient tout
drop policy if exists "missions visible by role" on public.missions;
create policy "missions visible by role" on public.missions
  for select using (
    public.current_user_role() in ('admin', 'manager')
    or assigned_to = auth.uid()
  );

drop policy if exists "missions manager admin write" on public.missions;
create policy "missions manager admin write" on public.missions
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- chef_equipe peut update sa propre mission (status, completion_notes)
drop policy if exists "missions assignee update" on public.missions;
create policy "missions assignee update" on public.missions
  for update using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());

-- ============================================================
-- mission_checklist_items, mission_photos, incidents
-- (visibilité dérivée de la mission parente)
-- ============================================================
alter table public.mission_checklist_items enable row level security;
alter table public.mission_photos          enable row level security;
alter table public.incidents               enable row level security;

drop policy if exists "checklist visible via mission" on public.mission_checklist_items;
create policy "checklist visible via mission" on public.mission_checklist_items
  for select using (
    exists (
      select 1 from public.missions m
       where m.id = mission_checklist_items.mission_id
         and (public.current_user_role() in ('admin', 'manager') or m.assigned_to = auth.uid())
    )
  );

drop policy if exists "checklist write via mission" on public.mission_checklist_items;
create policy "checklist write via mission" on public.mission_checklist_items
  for all using (
    exists (
      select 1 from public.missions m
       where m.id = mission_checklist_items.mission_id
         and (public.current_user_role() in ('admin', 'manager') or m.assigned_to = auth.uid())
    )
  );

drop policy if exists "photos visible via mission" on public.mission_photos;
create policy "photos visible via mission" on public.mission_photos
  for select using (
    exists (
      select 1 from public.missions m
       where m.id = mission_photos.mission_id
         and (public.current_user_role() in ('admin', 'manager') or m.assigned_to = auth.uid())
    )
  );

drop policy if exists "photos write via mission" on public.mission_photos;
create policy "photos write via mission" on public.mission_photos
  for all using (
    exists (
      select 1 from public.missions m
       where m.id = mission_photos.mission_id
         and (public.current_user_role() in ('admin', 'manager') or m.assigned_to = auth.uid())
    )
  );

drop policy if exists "incidents visible via mission" on public.incidents;
create policy "incidents visible via mission" on public.incidents
  for select using (
    exists (
      select 1 from public.missions m
       where m.id = incidents.mission_id
         and (public.current_user_role() in ('admin', 'manager') or m.assigned_to = auth.uid())
    )
  );

drop policy if exists "incidents write via mission" on public.incidents;
create policy "incidents write via mission" on public.incidents
  for all using (
    exists (
      select 1 from public.missions m
       where m.id = incidents.mission_id
         and (public.current_user_role() in ('admin', 'manager') or m.assigned_to = auth.uid())
    )
  );

-- ============================================================
-- tenders + documents + analyses (manager + admin only)
-- ============================================================
alter table public.tenders          enable row level security;
alter table public.tender_documents enable row level security;
alter table public.tender_analyses  enable row level security;

drop policy if exists "tenders manager admin all" on public.tenders;
create policy "tenders manager admin all" on public.tenders
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

drop policy if exists "tender_documents manager admin all" on public.tender_documents;
create policy "tender_documents manager admin all" on public.tender_documents
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

drop policy if exists "tender_analyses manager admin all" on public.tender_analyses;
create policy "tender_analyses manager admin all" on public.tender_analyses
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- ============================================================
-- reports (manager + admin write, all read)
-- ============================================================
alter table public.reports enable row level security;

drop policy if exists "reports authenticated read" on public.reports;
create policy "reports authenticated read" on public.reports
  for select using (auth.role() = 'authenticated');

drop policy if exists "reports manager admin write" on public.reports;
create policy "reports manager admin write" on public.reports
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- ============================================================
-- knowledge_items (manager + admin)
-- ============================================================
alter table public.knowledge_items enable row level security;

drop policy if exists "knowledge manager admin all" on public.knowledge_items;
create policy "knowledge manager admin all" on public.knowledge_items
  for all using (public.current_user_role() in ('admin', 'manager'))
  with check (public.current_user_role() in ('admin', 'manager'));

-- ============================================================
-- ai_usage (admin read seulement, écriture par service role)
-- ============================================================
alter table public.ai_usage enable row level security;

drop policy if exists "ai_usage admin read" on public.ai_usage;
create policy "ai_usage admin read" on public.ai_usage
  for select using (public.current_user_role() = 'admin');

-- ============================================================
-- activity_logs (admin/manager read, écriture par service role)
-- ============================================================
alter table public.activity_logs enable row level security;

drop policy if exists "activity_logs admin manager read" on public.activity_logs;
create policy "activity_logs admin manager read" on public.activity_logs
  for select using (public.current_user_role() in ('admin', 'manager'));
