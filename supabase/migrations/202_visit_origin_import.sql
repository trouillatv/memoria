-- Migration 202 — « import » est une origine de visite légitime.
--
-- BUG DE PRODUCTION, trouvé le 2026-07-14 en rejouant l'insert contre la vraie
-- base : `site_reports.origin` n'acceptait que 'planned', 'spontaneous', 'qr',
-- 'gps' (mig 162). Or le moteur d'ingestion (`createVisit` dans ingestBatch)
-- écrit `origin = 'import'` depuis toujours.
--
-- Conséquence : **toute création de visite par import échouait**. Pas seulement
-- le partage Android — le ZIP WhatsApp et l'upload aussi. L'erreur remontait à
-- l'utilisateur en « Quelque chose s'est passé », sans jamais dire pourquoi.
--
-- La contrainte avait raison de refuser une valeur inconnue : c'est la LISTE qui
-- était incomplète. Une visite née d'un import est bien une visite — elle a
-- juste une autre origine. Et cette origine, on la connaît : on l'écrit.
--
-- Additif : les valeurs existantes restent valides. `origin IS NULL` continue de
-- signifier « réunion » (mig 162) — cet invariant n'est pas touché.

alter table public.site_reports
  drop constraint if exists site_reports_origin_check;

alter table public.site_reports
  add constraint site_reports_origin_check
  check (origin is null or origin in ('planned', 'spontaneous', 'qr', 'gps', 'import'));

comment on column public.site_reports.origin is
  'Origine de la visite : planned | spontaneous | qr | gps | import. NULL = réunion (jamais une visite terrain).';
