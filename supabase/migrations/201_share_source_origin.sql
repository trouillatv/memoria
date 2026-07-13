-- Migration 201 — « os_share » est une provenance à part entière.
--
-- Chaque source d'une réunion conserve son origine (mig 193) :
--   'memoria' = captée dans l'app · 'phone' = relais de l'enregistreur du
--   téléphone · 'import' = fichier ajouté, origine inconnue.
--
-- Un fichier arrivé par le PARTAGE Android n'est pas d'origine inconnue : on
-- sait exactement d'où il vient. L'appeler « import » serait perdre une
-- information qu'on possède — et la provenance est précisément ce que ce
-- produit ne perd jamais.
--
-- Additif et réversible : les valeurs existantes restent valides.

alter table public.site_report_attachments
  drop constraint if exists site_report_attachments_source_origin_check;

alter table public.site_report_attachments
  add constraint site_report_attachments_source_origin_check
  check (source_origin is null or source_origin in ('memoria', 'phone', 'import', 'os_share'));
