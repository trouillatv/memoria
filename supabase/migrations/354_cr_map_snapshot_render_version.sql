-- 354_cr_map_snapshot_render_version.sql
-- Correction Bug A (Vincent, audit 2026-08-27) : le rapport « Inspection
-- DIMENC - Sireis » a un instantané carte généré ~12h AVANT le correctif
-- police Resvg (commit ddcccbfb) — les numéros de repère y sont absents,
-- sans que ensureCrMapSnapshot() n'ait aucun moyen de le détecter, car son
-- seul critère de fraîcheur est cr_map_snapshot_base_layer === cr_map_base_layer
-- (le FOND choisi), pas la version du moteur de rendu qui a produit le PNG.
--
-- Audit en base : 10/10 rapports avec un snapshot stocké prédatent ce
-- correctif. Sans ce champ, tout futur changement du moteur de rendu
-- (typographie, clustering, couleurs...) retomberait dans le même piège —
-- une invalidation ponctuelle par date de commit n'est pas durable.
--
-- cr_map_snapshot_render_version porte la version du moteur AVEC LAQUELLE le
-- PNG actuellement référencé par cr_map_snapshot_path a été produit.
-- ensureCrMapSnapshot() régénère si render_version IS NULL OU différente de
-- CURRENT_CR_MAP_RENDER_VERSION (lib/pdf/cr-map-snapshot.ts), en plus du
-- critère de fond déjà en place (migration 353) — les deux conditions sont
-- indépendantes, jamais recombinées.
alter table site_reports
  add column if not exists cr_map_snapshot_render_version integer null;

comment on column site_reports.cr_map_snapshot_render_version is
  'Version du moteur de rendu (CURRENT_CR_MAP_RENDER_VERSION, lib/pdf/cr-map-snapshot.ts) avec laquelle le PNG actuellement reference par cr_map_snapshot_path a ete produit. NULL = anterieur a l''introduction du versionnement (tout snapshot pre-ddcccbfb, potentiellement sans police embarquee). ensureCrMapSnapshot() regenere si differente de la version courante, independamment du fond Plan/Satellite.';

-- Pas de backfill à une valeur certaine ici (contrairement à la migration 353) :
-- TOUT snapshot existant à ce jour a été produit avant l'introduction du
-- versionnement, donc NULL est la valeur correcte et volontaire — elle force
-- la régénération au prochain accès, ce qui est exactement l'effet recherché.
