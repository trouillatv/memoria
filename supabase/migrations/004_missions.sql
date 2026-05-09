-- Missions terrain + checklist + photos + incidents

create table public.missions (
  id                    uuid primary key default gen_random_uuid(),
  site_id               uuid not null references sites(id) on delete restrict,
  scheduled_date        date not null,
  scheduled_start       time,
  scheduled_end         time,
  assigned_to           uuid references public.users(id) on delete set null,
  status                mission_status not null default 'pending',
  notes                 text,
  completion_notes      text,
  closed_with_deviation boolean default false,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_by            uuid not null references public.users(id),
  created_at            timestamptz default now(),
  deleted_at            timestamptz
);

create index missions_assigned_to_idx    on public.missions(assigned_to) where deleted_at is null;
create index missions_status_idx         on public.missions(status)      where deleted_at is null;
create index missions_scheduled_date_idx on public.missions(scheduled_date) where deleted_at is null;

create table public.mission_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id) on delete cascade,
  label      text not null,
  position   int  not null,
  is_done    boolean default false,
  done_at    timestamptz,
  done_by    uuid references public.users(id) on delete set null
);

create index mission_checklist_items_mission_idx on public.mission_checklist_items(mission_id);

create table public.mission_photos (
  id           uuid primary key default gen_random_uuid(),
  mission_id   uuid not null references missions(id) on delete cascade,
  storage_path text not null,
  kind         text not null check (kind in ('before', 'after', 'incident', 'other')),
  caption      text,
  taken_at     timestamptz default now(),
  taken_by     uuid references public.users(id) on delete set null
);

create index mission_photos_mission_idx on public.mission_photos(mission_id);

create table public.incidents (
  id          uuid primary key default gen_random_uuid(),
  mission_id  uuid not null references missions(id) on delete cascade,
  severity    incident_severity not null default 'medium',
  description text not null,
  resolved_at timestamptz,
  reported_by uuid references public.users(id) on delete set null,
  created_at  timestamptz default now()
);

create index incidents_mission_idx on public.incidents(mission_id);
