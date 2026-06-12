-- Migration 092 : QR Code par site (accès public lecture seule)
--
-- Ajoute un token court unique sur chaque site.
-- Le token est généré à la demande par un admin/manager.
-- La page publique /qr/[token] affiche le journal du site sans login.
-- Pattern identique aux handover_briefs.shared_token.

alter table public.sites
  add column if not exists qr_token       text unique,
  add column if not exists qr_generated_at timestamptz,
  add column if not exists qr_access_count integer not null default 0,
  add column if not exists qr_last_accessed_at timestamptz;

create unique index if not exists idx_sites_qr_token
  on public.sites(qr_token)
  where qr_token is not null and deleted_at is null;
