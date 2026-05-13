-- Migration 040 — Intégrité cryptographique des photos.
--
-- Phase 1.1 du plan « mémoire défendable ». Ajoute le hash SHA-256 calculé
-- côté serveur à l'upload, plus les métadonnées associées (mime, taille,
-- timestamp côté client si dispo). Permet de prouver qu'une photo n'a pas
-- été altérée entre l'upload et la production du dossier de preuve.
--
-- Sans cette donnée, un avocat adverse peut pointer que les photos sont
-- techniquement remplaçables dans le bucket sans laisser de trace en base.
-- Avec cette donnée, le contenu en base est lié cryptographiquement au
-- fichier dans le bucket.

alter table public.intervention_photos
  add column if not exists sha256 text,
  add column if not exists mime_type text,
  add column if not exists size_bytes integer,
  add column if not exists client_timestamp timestamptz,
  add column if not exists hash_origin text not null default 'unknown'
    check (hash_origin in ('verified', 'retroactive', 'unknown'));

-- Index pour la vérification d'intégrité par hash (recherche d'un hash donné).
create index if not exists intervention_photos_sha256_idx
  on public.intervention_photos(sha256)
  where sha256 is not null;

comment on column public.intervention_photos.sha256 is
  'SHA-256 du contenu binaire calculé côté serveur à l''upload. Permet de vérifier l''intégrité du fichier dans le bucket.';

comment on column public.intervention_photos.hash_origin is
  '''verified'' = calculé à l''upload (Phase 1.1+). ''retroactive'' = backfill a posteriori. ''unknown'' = legacy avant migration 040.';
