-- Migration 043 — Indexation full-text de la mémoire (Phase 2.1).
--
-- Crée des colonnes tsvector générées sur les tables qui constituent la
-- mémoire utile : anomalies, notes de sites, notes d'intervention, captions
-- photos. Index GIN pour recherche rapide.
--
-- Stratégie : configuration 'french' pour le stemming + unaccent pour la
-- tolérance aux accents (« humidité » trouve « humidite »).

create extension if not exists unaccent with schema extensions;

-- Configuration FTS française avec unaccent. À utiliser comme `to_tsvector('french_unaccent', ...)`.
do $$ begin
  create text search configuration public.french_unaccent (copy = french);
  alter text search configuration public.french_unaccent
    alter mapping for hword, hword_part, word
    with extensions.unaccent, french_stem;
exception
  when unique_violation then null; -- déjà créée
end $$;

-- ─── intervention_anomalies ───────────────────────────────────────────────
alter table public.intervention_anomalies
  add column if not exists tsv tsvector
  generated always as (
    to_tsvector('public.french_unaccent',
      coalesce(description, '') || ' ' ||
      coalesce(category_other, '') || ' ' ||
      coalesce(resolution_note, '')
    )
  ) stored;

create index if not exists intervention_anomalies_tsv_idx
  on public.intervention_anomalies using gin (tsv);

-- ─── site_notes ───────────────────────────────────────────────────────────
alter table public.site_notes
  add column if not exists tsv tsvector
  generated always as (
    to_tsvector('public.french_unaccent', coalesce(body, ''))
  ) stored;

create index if not exists site_notes_tsv_idx
  on public.site_notes using gin (tsv);

-- ─── interventions (notes libres) ─────────────────────────────────────────
alter table public.interventions
  add column if not exists tsv tsvector
  generated always as (
    to_tsvector('public.french_unaccent', coalesce(notes, ''))
  ) stored;

create index if not exists interventions_tsv_idx
  on public.interventions using gin (tsv);

-- ─── intervention_photos (captions) ───────────────────────────────────────
alter table public.intervention_photos
  add column if not exists tsv tsvector
  generated always as (
    to_tsvector('public.french_unaccent', coalesce(caption, ''))
  ) stored;

create index if not exists intervention_photos_tsv_idx
  on public.intervention_photos using gin (tsv);
