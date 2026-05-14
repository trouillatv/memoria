-- Migration 049 — Ajout 'passage' à photo_kind enum (Sprint V5.1).
--
-- Décision Vincent 2026-05-14 : la trace banale déposée hors workflow
-- d'intervention planifiée (Slice 1, dépôt photo offline-first) doit
-- avoir son propre kind. Ne PAS réutiliser 'proof' — 'proof' implique
-- qualification juridique, ce qu'un passage spontané n'est pas.
--
-- Une photo de kind='passage' devient preuve par contexte (gel, partage,
-- dossier) mais ne l'est pas par défaut.
--
-- Valeurs photo_kind après migration :
--   'before'  : photo avant intervention (existing, migration 018)
--   'after'   : photo après intervention (existing, migration 018)
--   'anomaly' : photo liée à anomalie (existing, migration 018)
--   'proof'   : preuve qualifiée pour dossier (existing, migration 018)
--   'passage' : trace banale de présence spontanée (V5.1) — NEW
--
-- Note technique : ALTER TYPE ... ADD VALUE doit être dans sa propre
-- migration. Le premier INSERT utilisant 'passage' arrivera côté code Slice 1.

ALTER TYPE photo_kind ADD VALUE IF NOT EXISTS 'passage';

COMMENT ON TYPE photo_kind IS
  'V5.1 (2026-05-14) : ajout ''passage'' pour traces banales hors workflow intervention planifiée. ''proof'' reste réservé aux preuves qualifiées (gel, partage, dossier).';
