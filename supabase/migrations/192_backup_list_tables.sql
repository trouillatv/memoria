-- 192 — backup_list_tables : énumération dynamique des tables pour le cron
-- backup (Vincent 2026-07-09).
--
-- CONSTAT : la liste TABLES en dur du cron backup datait (~mig 110) — les
-- tables récentes (site_actions, site_decisions, site_reports, notifications,
-- subjects, dossiers, obligations…) n'étaient PAS sauvegardées. Une liste en
-- dur dérive toujours.
--
-- RÈGLE (Vincent) : toute table nouvelle est soit sauvegardée, soit
-- explicitement exclue AVEC justification (const EXCLUDED de la route).
-- L'énumération devient dynamique : une nouvelle table est sauvegardée par
-- défaut, sans geste humain.

create or replace function public.backup_list_tables()
returns setof text
language sql
security definer
set search_path = public, pg_catalog
as $$
  select tablename::text
  from pg_catalog.pg_tables
  where schemaname = 'public'
  order by tablename
$$;

-- Exécution réservée au service-role (le cron) — jamais côté client.
revoke all on function public.backup_list_tables() from public;
revoke all on function public.backup_list_tables() from anon;
revoke all on function public.backup_list_tables() from authenticated;
grant execute on function public.backup_list_tables() to service_role;

comment on function public.backup_list_tables() is
  'Énumère les tables du schéma public pour le cron backup (mig 192). Toute nouvelle table est sauvegardée par défaut ; les exclusions vivent dans la const EXCLUDED de app/api/cron/backup/route.ts, avec justification écrite. Service-role only.';
