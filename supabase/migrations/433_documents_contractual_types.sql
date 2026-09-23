-- Migration 433 — Types documentaires contractuels (CCTP / CCAP / Ordre de service)
--
-- P0-1 : entrée Document contractuel depuis la fiche chantier. Ces natures
-- routaient auparavant vers 'ao' (classifieur générique) ou auraient dû être
-- masquées sous 'reference' — types explicites demandés (Vincent 2026-09-23),
-- extension additive cohérente avec 'contrat'/'avenant' déjà existants. Aucune
-- extraction Engagement dans ce lot (P0-2).
--
-- La contrainte CHECK sur documents.document_type est un texte (pas un enum PG),
-- donc on la remplace intégralement — idiome déjà utilisé par 082, 123, 152, 256.
--
-- 'construction_schedule' (ajouté par la migration 372, gate de
-- extract-construction-schedule.ts) était absent de la liste initiale de ce
-- fichier : un remplacement intégral l'aurait silencieusement retiré des
-- valeurs acceptées. Reporté ici pour rester purement additif.

alter table public.documents
  drop constraint if exists documents_document_type_check;

alter table public.documents
  add constraint documents_document_type_check
  check (document_type in (
    'contrat','avenant','procedure','protocole','plan_acces','securite',
    'ao','memoire_technique','reference','litige','facture','preuve','autre',
    'historical_visit_report','construction_schedule',
    'cctp','ccap','ordre_service'
  ));
