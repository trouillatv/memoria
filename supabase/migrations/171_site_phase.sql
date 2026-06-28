-- Phase de vie du dossier (Vincent 2026-06-29).
--
-- DÉCISION D'ARCHI : le SITE est la colonne vertébrale. Un dossier naît dès la
-- PRÉVISITE (avant le contrat) comme « opportunité », puis change de PHASE sans
-- jamais changer d'identité — pas de copie, pas de conversion, donc pas de
-- rupture de mémoire au passage AO → chantier. Le tender et le contrat
-- deviennent des ÉVÉNEMENTS rattachés au site (tranche 2), pas des silos.
--
--   prospect → en_ao → actif → perdu → archive
--
-- Tous les sites existants sont des chantiers réels → 'actif' par défaut.

alter table public.sites
  add column if not exists phase text not null default 'actif';

alter table public.sites
  drop constraint if exists sites_phase_check;
alter table public.sites
  add constraint sites_phase_check
  check (phase in ('prospect', 'en_ao', 'actif', 'perdu', 'archive'));

-- Pour filtrer les opportunités hors des vues chantier (et inversement).
create index if not exists sites_phase_idx on public.sites(phase) where deleted_at is null;
