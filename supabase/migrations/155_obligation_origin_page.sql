-- Migration 155 — Numéro de page d'origine (Vincent 2026-06-22, Sprint C1).
--
-- Pour rendre la provenance NAVIGABLE (« origine : CCTP · p.148 » → ouvre le PDF
-- à la page 148), il faut le numéro de page brut (origin_ref est un libellé texte).
-- Saut à la page via le viewer natif (#page=N) — pas de pdf.js, pas de surlignage.

alter table public.site_obligation
  add column if not exists origin_page int;

comment on column public.site_obligation.origin_page is
  'Numéro de page de la clause source dans le PDF d''origine (pour le saut à la page #page=N). NULL si inconnu.';
