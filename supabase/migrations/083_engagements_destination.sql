-- Migration 083 — destination des propositions (Atelier IA v2, Phase 1).
--
-- Vincent 2026-05-25. Additif, idempotent, NON destructif.
-- Cf. mémoire projet [[ingestion-memorielle-pipeline]] + direction Atelier IA v2.
--
-- L'engagement extrait d'un AO devient une « proposition typée ». Sa destination
-- (validée par l'humain à la curation) :
--   contract_engagement (défaut) : obligation de contrat (comportement actuel).
--   vigilance                    : risque / pénalité / point sensible (rattaché
--                                  contrat/AO, sans dépendre d'un site).
--   a_savoir / mission           : site-scopés — RÉSERVÉS, matérialisés seulement
--                                  à la conversion (option A). Pas câblés en V1.
--
-- Défaut 'contract_engagement' → toutes les lignes existantes restent inchangées.

alter table public.engagements
  add column if not exists destination text not null default 'contract_engagement';

alter table public.engagements drop constraint if exists engagements_destination_check;
alter table public.engagements add constraint engagements_destination_check
  check (destination in ('contract_engagement', 'vigilance', 'a_savoir', 'mission'));

comment on column public.engagements.destination is
  'Destination de la proposition (validée par l''humain) : contract_engagement | vigilance | a_savoir | mission.';
