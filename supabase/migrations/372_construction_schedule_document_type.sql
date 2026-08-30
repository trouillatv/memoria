-- Migration 372 — Type documentaire « planning de travaux » (Planning V1-B).
--
-- extract-construction-schedule.ts (0dd185c1) gate sur document_type =
-- 'construction_schedule', mais aucune migration n'avait jusqu'ici élargi la
-- contrainte CHECK pour accepter cette valeur. Élargissement pur, sans perte,
-- même idiome que 256.

alter table public.documents
  drop constraint if exists documents_document_type_check;

alter table public.documents
  add constraint documents_document_type_check
  check (document_type in (
    'contrat','avenant','procedure','protocole','plan_acces','securite',
    'ao','memoire_technique','reference','litige','facture','preuve','autre',
    'historical_visit_report','construction_schedule'
  ));
