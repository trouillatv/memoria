-- Instantané carte du compte-rendu (mig 188).
--
-- RÈGLE : le PDF ne GÉNÈRE jamais la carte, il CONSOMME un instantané déjà
-- produit. L'image de carte (tuiles OSM assemblées côté serveur, User-Agent
-- propre) est fabriquée UNE SEULE FOIS — à l'ouverture de l'aperçu du CR — puis
-- réutilisée à chaque génération de PDF. Propriété forte : le CR devient STABLE
-- (régénérer le PDF plus tard redonne exactement la même carte).
--
-- NULL = pas encore produit (ou aucune position géolocalisée) → le PDF retombe
-- automatiquement sur le schéma métrique. Le compte-rendu est toujours généré.

alter table site_reports add column if not exists cr_map_snapshot_path text;

comment on column site_reports.cr_map_snapshot_path is
  'Chemin storage (bucket site-reports) de l''instantané carte du CR (mig 188). Fabriqué une seule fois, réutilisé par le PDF. NULL → PDF en schéma métrique.';
