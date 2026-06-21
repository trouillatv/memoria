-- Migration 156 — Chapitre/section d'origine (Vincent 2026-06-22, Sprint C1 affiné).
--
-- Usage 1 « montre-moi le passage » : l'extrait est le héros (source / page /
-- CHAPITRE / extrait complet), le PDF est secondaire. On conserve donc la section
-- de la clause source (« 4.3.2 Documentation de fin d'exécution »).

alter table public.site_obligation
  add column if not exists origin_section text;

comment on column public.site_obligation.origin_section is
  'Chapitre/section de la clause source (« 4.3.2 … »), affiché dans l''aperçu de provenance. NULL si inconnu.';
