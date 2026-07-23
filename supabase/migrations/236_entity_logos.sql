-- Migration 236 — Logos maîtrisés (M4a consolidation)
--
-- 1. organizations.logo_path + logo_updated_at (stockage contrôlé via bucket).
--    organizations.logo_url déprécié mais conservé pour compatibilité.
-- 2. Contrainte color #RRGGBB — n'avait pas été appliquée car mig 235 était
--    déjà exécutée quand la contrainte y a été ajoutée.
-- 3. Bucket entity-logos (privé) + politique SELECT pour authenticated.

-- ── Colonnes ──────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists logo_path       text,
  add column if not exists logo_updated_at timestamptz;

comment on column public.organizations.logo_url is
  'DEPRECATED — remplacé par logo_path (chemin bucket entity-logos). Sera supprimé après migration des données existantes.';

-- ── Contrainte couleur ────────────────────────────────────────────────────────

alter table public.organizations
  drop constraint if exists organizations_color_hex_format,
  add  constraint organizations_color_hex_format
    check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');

-- ── Bucket privé entity-logos ─────────────────────────────────────────────────
-- Privé : les logos sont servis via URLs signées (TTL 7 j) générées côté serveur.
-- L'upload est réservé au service role (admin) ; le SELECT nécessite auth.

insert into storage.buckets (id, name, public)
  values ('entity-logos', 'entity-logos', false)
  on conflict (id) do nothing;

drop policy if exists "entity-logos read for authenticated" on storage.objects;
create policy "entity-logos read for authenticated"
  on storage.objects for select
  using (bucket_id = 'entity-logos' and auth.role() = 'authenticated');
