-- Rapports de mission (1 mission ↔ 1 rapport au plus)

create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  mission_id       uuid not null unique references missions(id) on delete cascade,
  validated_by     uuid references public.users(id) on delete set null,
  validated_at     timestamptz,
  pdf_storage_path text,
  notes            text,
  created_at       timestamptz default now()
);
