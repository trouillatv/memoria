-- Migration 092 : table site_access_tokens (QR Code chantier — accès public lecture seule)
--
-- Un token par site (purpose = 'journal_public').
-- Révocable via revoked_at. Expiry optionnel via expires_at.
-- La page publique /qr/[token] vérifie révocation + expiry avant d'afficher.
-- Pattern identique aux handover_briefs.shared_token pour la génération du token.

create table if not exists public.site_access_tokens (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites(id) on delete cascade,
  token          text not null unique,
  purpose        text not null default 'journal_public',
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  last_accessed_at timestamptz,
  access_count   integer not null default 0,
  revoked_at     timestamptz,
  expires_at     timestamptz
);

create unique index if not exists idx_site_access_tokens_token
  on public.site_access_tokens(token);

create index if not exists idx_site_access_tokens_site_id
  on public.site_access_tokens(site_id);

-- RLS : lecture via admin uniquement (admin client Supabase contourne RLS).
alter table public.site_access_tokens enable row level security;

-- Les admins et managers peuvent voir les tokens de leur organisation.
create policy "org members can read tokens"
  on public.site_access_tokens
  for select
  using (
    site_id in (
      select s.id from public.sites s
      join public.profiles p on p.organization_id = s.organization_id
      where p.id = auth.uid()
        and p.role in ('admin', 'manager')
        and s.deleted_at is null
    )
  );

-- Insertion gérée via server action (createAdminClient — contourne RLS).
-- Pas de policy insert/update nécessaire pour les routes dashboard.
