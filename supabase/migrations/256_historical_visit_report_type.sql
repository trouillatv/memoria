-- Migration 256 — Type documentaire « PV / rapport de visite historique »
--
-- Sprint 4A : rattachement multi-PDF d'archives PV à un chantier SANS extraction
-- ni création d'objets métier. Le type est déclaré ici ; la garde contre l'auto-
-- extraction est dans uploadDocumentAction (embed = false forcé côté applicatif,
-- identique au pattern litige).
--
-- La contrainte CHECK sur documents.document_type est un texte (pas un enum PG),
-- donc on la remplace intégralement — idiome déjà utilisé par 082, 123, 152…

alter table public.documents
  drop constraint if exists documents_document_type_check;

alter table public.documents
  add constraint documents_document_type_check
  check (document_type in (
    'contrat','avenant','procedure','protocole','plan_acces','securite',
    'ao','memoire_technique','reference','litige','facture','preuve','autre',
    'historical_visit_report'
  ));
