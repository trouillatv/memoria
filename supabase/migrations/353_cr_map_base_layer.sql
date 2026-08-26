-- 353_cr_map_base_layer.sql
-- Lot Carte PDF Plan/Satellite (Vincent, 2026-08-26). Le choix du fond de carte
-- DU PDF est propre au rapport — distinct de memoria.map.baseLayer (préférence
-- interactive côté client, autres surfaces) : cr_map_base_layer mémorise le
-- choix explicite de CE rapport, NULL = jamais choisi → comportement historique
-- inchangé (Plan).
--
-- cr_map_snapshot_base_layer porte le fond AVEC LEQUEL le PNG actuellement
-- référencé par cr_map_snapshot_path a réellement été généré. Sans ce second
-- champ, ensureCrMapSnapshot() ne pourrait pas distinguer « instantané à jour »
-- de « instantané périmé par rapport au choix courant » — et risquerait de
-- présenter un Plan comme un Satellite (ou l'inverse) après un changement de
-- fond. Les deux champs ne sont JAMAIS recombinés avec triage_intent/
-- included_in_cr (cf. [[reportage-photo-cr-editorial-valide]]) : trois axes
-- distincts, jamais confondus.
alter table site_reports
  add column if not exists cr_map_base_layer text null,
  add column if not exists cr_map_snapshot_base_layer text null;

alter table site_reports
  drop constraint if exists site_reports_cr_map_base_layer_check;

alter table site_reports
  add constraint site_reports_cr_map_base_layer_check
    check (cr_map_base_layer is null or cr_map_base_layer in ('plan', 'satellite'));

alter table site_reports
  drop constraint if exists site_reports_cr_map_snapshot_base_layer_check;

alter table site_reports
  add constraint site_reports_cr_map_snapshot_base_layer_check
    check (cr_map_snapshot_base_layer is null or cr_map_snapshot_base_layer in ('plan', 'satellite'));

comment on column site_reports.cr_map_base_layer is
  'Fond de carte choisi par l''utilisateur pour LE PDF de ce rapport (plan|satellite). NULL = jamais choisi explicitement -> comportement historique inchange (Plan). Distinct de la preference interactive memoria.map.baseLayer (client, autres surfaces) : ce champ memorise le choix propre a CE rapport.';

comment on column site_reports.cr_map_snapshot_base_layer is
  'Fond de carte AVEC LEQUEL le PNG actuellement reference par cr_map_snapshot_path a reellement ete genere (plan|satellite). Permet a ensureCrMapSnapshot() de detecter qu''un instantane est perime par rapport a cr_map_base_layer sans jamais faire passer un Plan pour un Satellite (ou l''inverse).';

-- Backfill sûr : avant ce lot, TOUT instantané existant a nécessairement été
-- produit par le moteur OSM (aucun autre moteur n'existait) — donc 'plan' de
-- façon certaine, jamais une supposition. Sans ce backfill, ensureCrMapSnapshot()
-- verrait cr_map_snapshot_base_layer=null != chosen='plan' et régénérerait
-- inutilement (mêmes tuiles, même rendu) au premier accès après déploiement.
update site_reports
  set cr_map_snapshot_base_layer = 'plan'
  where cr_map_snapshot_path is not null
    and cr_map_snapshot_base_layer is null;
