-- Migration 096 : journal des scans QR individuels
--
-- Complète site_access_tokens (agrégat) avec un log détaillé par scan.
-- Pas d'IP (RGPD). User-agent pour distinguer mobile/navigateur uniquement.
-- Insertion via admin client — pas de policy INSERT nécessaire.

create table if not exists public.qr_access_log (
  id         uuid primary key default gen_random_uuid(),
  token_id   uuid not null references public.site_access_tokens(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  user_agent text
);

create index if not exists idx_qr_access_log_token
  on public.qr_access_log(token_id, scanned_at desc);

alter table public.qr_access_log enable row level security;

-- Admins et managers de l'organisation concernée peuvent lire.
create policy "org members can read qr access log"
  on public.qr_access_log
  for select
  using (
    token_id in (
      select sat.id
      from public.site_access_tokens sat
      join public.sites s on s.id = sat.site_id
      join public.users u on u.organization_id = s.organization_id
      where u.id = auth.uid()
        and u.role in ('admin', 'manager')
        and s.deleted_at is null
    )
  );
