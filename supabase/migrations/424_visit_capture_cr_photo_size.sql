-- 424_visit_capture_cr_photo_size.sql
-- Taille visuelle explicite par photo dans le CR (Vincent, 2026-09-21) : jusqu'ici
-- la mise en page (2/ligne pour les Photos clés, 4/ligne pour le Reportage) était
-- FIXE, identique pour toutes les photos d'une même catégorie. `cr_photo_size`
-- porte un choix humain optionnel de taille — troisième propriété, INDÉPENDANTE
-- de `included_in_cr` (présence) et `cr_tier` (catégorie documentaire Photo clé /
-- Reportage), qu'elle ne modifie ni ne remplace. NULL = Auto (comportement
-- historique exact de la catégorie, aucune rétro-application sur les photos
-- existantes). 'S'/'M'/'L'/'XL' pilotent uniquement la largeur relative dans le
-- composeur (lib/pdf/visit-cr.tsx), jamais le recadrage (contain reste obligatoire).
alter table visit_capture
  add column if not exists cr_photo_size text null;

alter table visit_capture
  drop constraint if exists visit_capture_cr_photo_size_check;

alter table visit_capture
  add constraint visit_capture_cr_photo_size_check check (cr_photo_size is null or cr_photo_size in ('S', 'M', 'L', 'XL'));
