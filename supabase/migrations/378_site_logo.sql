-- Migration 378 — image propre au CHANTIER (site), en plus du logo du client.
--
-- Jusqu'ici seul le client portait un logo (clients.logo_path), partagé par tous
-- ses chantiers. On ajoute une image AU NIVEAU DU CHANTIER, indépendante, réutilisant
-- l'infra logos existante (bucket privé entity-logos, colonnes logo_path/logo_updated_at,
-- URLs signées). Purement additif : colonnes nullable, aucune donnée touchée.

alter table public.sites
  add column if not exists logo_path       text,
  add column if not exists logo_updated_at timestamptz;

comment on column public.sites.logo_path is
  'Chemin bucket entity-logos de l''image PROPRE au chantier (distincte du logo client). Nullable.';
