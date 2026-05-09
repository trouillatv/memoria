-- Audit trail minimal — 7 événements sensibles

create table public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete set null,
  entity_type text not null,
  entity_id   uuid,
  action      text not null,
  metadata    jsonb,
  created_at  timestamptz default now()
);

create index activity_logs_entity_idx     on public.activity_logs(entity_type, entity_id);
create index activity_logs_created_at_idx on public.activity_logs(created_at desc);
create index activity_logs_user_idx       on public.activity_logs(user_id);
