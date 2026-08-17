-- 340_visit_capture_cr_tier.sql
-- Statut éditorial explicite Photo clé / Reportage (Vincent, 2026-08-18) : jusqu'ici
-- ce tri restait un EFFET DE BORD du poids automatique (starred/triage_intent/plafond),
-- jamais un choix affiché ni modifiable par photo. `cr_tier` porte ce choix HUMAIN,
-- séparé — NULL par défaut (comportement automatique inchangé, aucune régression sur
-- les CR déjà produits) ; 'key'/'reportage' priment ensuite sur le calcul automatique
-- dans selectCrPhotos() (lib/db/visits.ts). Ne touche ni triage_intent, ni starred, ni
-- included_in_cr (le "Hors CR" des trois états reste porté par included_in_cr=false).
alter table visit_capture
  add column if not exists cr_tier text null;

alter table visit_capture
  drop constraint if exists visit_capture_cr_tier_check;

alter table visit_capture
  add constraint visit_capture_cr_tier_check check (cr_tier is null or cr_tier in ('key', 'reportage'));
