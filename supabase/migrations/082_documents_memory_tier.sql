-- Migration 082 — memory_tier sur documents (pipeline d'ingestion mémorielle).
--
-- Vincent 2026-05-23. Additif, idempotent, NON destructif.
-- Cf. mémoire projet [[ingestion-memorielle-pipeline]].
--
-- Couche mémoire décidée à l'ingestion (l'IA propose, l'humain valide) :
--   vivante     : transformable en artefacts (à savoir, signaux).
--   consultable : embeddings + recherche.
--   froide      : stockée, NON indexée (pas d'embedding) — archive.
-- NULL = legacy (documents importés avant le tri).
--
-- L'embedding sélectif est porté côté applicatif (on ne lance analyzeDocument
-- que pour vivante/consultable). Les documents froids restent en
-- analysis_status='ready' sans chunks.

alter table public.documents
  add column if not exists memory_tier text;

alter table public.documents drop constraint if exists documents_memory_tier_check;
alter table public.documents add constraint documents_memory_tier_check
  check (memory_tier is null or memory_tier in ('vivante', 'consultable', 'froide'));

comment on column public.documents.memory_tier is
  'Couche mémoire (vivante/consultable/froide) décidée à l''ingestion. NULL = legacy.';
