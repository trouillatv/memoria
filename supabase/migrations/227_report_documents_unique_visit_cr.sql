-- =============================================================================
-- 227 — UN SEUL CR ÉDITABLE PAR VISITE.
--
-- `getOrCreateVisitCrDocument` lit puis insère. Sans contrainte, deux appels
-- concurrents (double-tap, deux onglets, rechargement pendant la création)
-- créent DEUX documents : le conducteur corrige alors une version que la page
-- suivante n'affichera pas. La policy pure ne peut rien contre ça — seule la
-- base peut garantir l'unicité.
--
-- Index PARTIEL, volontairement : le PV de réunion, lui, peut légitimement
-- porter PLUSIEURS lignes pour un même rapport (chaque régénération en crée une,
-- et `getLatestReportDocument` prend la plus récente). Contraindre tout
-- `report_documents` casserait ce comportement. On ne contraint donc QUE le
-- template du CR de visite.
--
-- Additif et non destructif : aucune donnée existante n'est touchée. Si le
-- déploiement échouait ici, c'est qu'un doublon 'cr_visite.v1' existe déjà — il
-- faudrait alors le trancher à la main, jamais le supprimer automatiquement.
-- =============================================================================

create unique index if not exists uniq_report_documents_visit_cr
  on public.report_documents (report_id)
  where template_key = 'cr_visite.v1';
