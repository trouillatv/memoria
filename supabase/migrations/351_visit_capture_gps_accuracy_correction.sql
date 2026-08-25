-- 351_visit_capture_gps_accuracy_correction.sql
-- Cartographie des preuves terrain, Lot 1 — GPS fiable (Vincent, 2026-08-25).
--
-- Contrat de position (mandat Vincent, corrige la proposition initiale de l'audit) :
--   • lat/lng restent la MESURE GPS BRUTE HISTORIQUE au moment de la capture —
--     sémantique inchangée, jamais réécrites par une correction humaine.
--   • gps_accuracy_m = coords.accuracy du navigateur au moment de la capture.
--     NULL pour les captures historiques (pré-migration) et quand le navigateur
--     ne fournit pas de valeur exploitable — jamais une précision inventée au
--     backfill.
--   • corrected_lat/corrected_lng = correction manuelle humaine (Lot 3), NULL
--     tant qu'aucune correction n'a été posée. La position EFFECTIVE est
--     `corrected_lat/lng ?? lat/lng`, résolue par UNE primitive commune
--     (resolveEffectivePosition, lib/visits/geo.ts) réutilisée par la carte web,
--     le snapshot PDF et le schéma métrique de repli — jamais réimplémentée.
--
-- location_source ('gps' | 'manual') n'est délibérément PAS stocké : il se
-- déduit à 100 % de la présence de corrected_lat (manual si non-null, gps
-- sinon) — le stocker dupliquerait une information déjà portée par la
-- présence/absence de la correction, sans rien ajouter que resolveEffectivePosition
-- ne calcule déjà.

alter table visit_capture
  add column if not exists gps_accuracy_m double precision null;

alter table visit_capture
  add column if not exists corrected_lat double precision null;

alter table visit_capture
  add column if not exists corrected_lng double precision null;

-- Une correction est posée ou retirée en paire (Lot 3, action "revert" =
-- remise à null des deux) : jamais une coordonnée corrigée orpheline.
alter table visit_capture
  drop constraint if exists visit_capture_corrected_pair_check;

alter table visit_capture
  add constraint visit_capture_corrected_pair_check
  check ((corrected_lat is null) = (corrected_lng is null));

comment on column visit_capture.lat is
  'Mesure GPS brute au moment de la capture (coords.latitude). Historique, jamais modifiée par une correction manuelle — cf. corrected_lat.';
comment on column visit_capture.lng is
  'Mesure GPS brute au moment de la capture (coords.longitude). Historique, jamais modifiée par une correction manuelle — cf. corrected_lng.';
comment on column visit_capture.gps_accuracy_m is
  'Précision du GPS navigateur (coords.accuracy, mètres) au moment de la capture. NULL pour les captures historiques (avant mig 351) et quand le navigateur ne fournit pas de valeur exploitable — jamais une valeur inventée au backfill.';
comment on column visit_capture.corrected_lat is
  'Correction manuelle de la position (Lot 3, mig 351). NULL = pas de correction, la position effective reste lat/lng. Ne modifie jamais lat/lng. Toujours en paire avec corrected_lng (visit_capture_corrected_pair_check).';
comment on column visit_capture.corrected_lng is
  'Symétrique de corrected_lat.';
