-- Clients (donneurs d'ordre du nettoyeur) et leurs sites d'intervention

create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_name  text,
  contact_email text,
  contact_phone text,
  address       text,
  notes         text,
  created_at    timestamptz default now(),
  deleted_at    timestamptz
);

create index clients_name_idx on public.clients(name) where deleted_at is null;

create table public.sites (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  name       text not null,
  address    text,
  notes      text,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create index sites_client_idx on public.sites(client_id) where deleted_at is null;
