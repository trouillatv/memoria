-- Migration 087 — Sprint D (l'oubli) : statut « resolved » pour les résonances
-- (Vincent 2026-05-27).
--
-- « Clos » dans la grammaire du temps mémoriel : le sujet a EXISTÉ puis a été
-- TRAITÉ par un humain — distinct de « dismissed » (= « c'était faux »).
-- Réversible (on peut repasser active), audité côté action. Additif et
-- non destructif : on élargit le CHECK, aucune donnée existante ne le viole.

ALTER TABLE public.site_reading_candidates
  DROP CONSTRAINT IF EXISTS site_reading_candidates_status_check;

ALTER TABLE public.site_reading_candidates
  ADD CONSTRAINT site_reading_candidates_status_check
  CHECK (status IN ('active', 'stale', 'dismissed', 'resolved'));

COMMENT ON COLUMN public.site_reading_candidates.status IS
  'active | stale (sommeil) | dismissed (écarté=faux) | resolved (clos=traité humainement). Cf. lib/memory/temps-memoriel.ts';
