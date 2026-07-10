-- =============================================================================
-- 193 — PROVENANCE DES SOURCES AUDIO (Vincent 2026-07-10, fondation « la réunion
-- est l'objet ; tout ce qui l'enrichit est une source »).
-- Exigence 5 de la fondation : « chaque source audio conserve son origine, ses
-- horaires, sa durée et son statut de traitement. »
--
-- Une réunion accepte zéro, une ou plusieurs sources audio (mig 141). Deux
-- sources peuvent se CHEVAUCHER (in-app 07:56–08:18, puis enregistreur du
-- téléphone 08:17–09:31) : sans horodatages par source, la jonction est
-- indétectable et une phrase peut être transcrite deux fois. On stocke les
-- horaires DÈS la capture — l'UI de fusion fine attendra, pas le modèle.
-- Aucun contenu n'est jamais supprimé automatiquement sans trace.
--
-- source_origin : 'memoria' = capté dans l'app ; 'phone' = enregistreur du
-- téléphone (relais) ; 'import' = fichier ajouté (origine inconnue). NULL sur
-- les sources antérieures à cette migration.
-- =============================================================================

alter table public.site_report_attachments
  add column if not exists source_origin text
    check (source_origin in ('memoria', 'phone', 'import')),
  add column if not exists recorded_started_at timestamptz,
  add column if not exists recorded_ended_at   timestamptz;
