-- Migration 069 — Ajout 'access' à photo_kind enum (module Preuve d'accès site).
--
-- Décision Vincent 2026-05-18 : la photo OPTIONNELLE d'un trousseau/badge
-- attachée à un événement d'accès (prise / restitution) a son propre kind.
-- Ne PAS réutiliser 'proof' ('proof' implique qualification juridique de
-- propreté), ni 'passage' (trace de présence spontanée hors accès).
--
-- Une photo de kind='access' documente un acte d'accès au site. Elle reste
-- une preuve par contexte (gel, partage, dossier) mais n'est pas un livrable
-- de propreté.
--
-- Valeurs photo_kind après migration :
--   'before'  : photo avant intervention (018)
--   'after'   : photo après intervention (018)
--   'anomaly' : photo liée à anomalie (018)
--   'proof'   : preuve qualifiée pour dossier (018)
--   'passage' : trace banale de présence spontanée (049)
--   'access'  : photo d'un acte d'accès site — trousseau / badge (069) — NEW
--
-- Note technique : ALTER TYPE ... ADD VALUE doit être dans sa propre migration
-- (contrainte Postgres). Le premier INSERT avec 'access' arrive migration 070.

ALTER TYPE photo_kind ADD VALUE IF NOT EXISTS 'access';

COMMENT ON TYPE photo_kind IS
  '2026-05-18 : ajout ''access'' pour la photo optionnelle d''un acte d''accès site (trousseau/badge). ''proof'' reste réservé aux preuves de propreté qualifiées.';
