-- Logos des entreprises clientes rattachées aux sites.
alter table public.clients
  add column if not exists logo_path text,
  add column if not exists logo_updated_at timestamptz;

comment on column public.clients.logo_path is
  'Chemin privé dans le bucket entity-logos, servi par URL signée.';
