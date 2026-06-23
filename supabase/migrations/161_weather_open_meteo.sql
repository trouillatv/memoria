-- 161 — Météo Open-Meteo (Vincent 2026-06-24, commit 2 après les blocages)
--
-- On N'AJOUTE PAS de table météo : on ENRICHIT l'existant.
--   - `sites` : coordonnées (lat/lon) du chantier, pour interroger Open-Meteo.
--   - `site_day_log` (mig 108) : métriques journalières opposables récupérées de
--     l'API + provenance. La météo DOCUMENTE, elle ne crée jamais un blocage
--     (cf. [[litige-no-automatic-reading]]). Open-Meteo = sans clé, sans scraping.

-- Coordonnées du site (saisie manuelle, opposable ; géocodage Open-Meteo en aide).
alter table public.sites add column if not exists latitude  double precision;
alter table public.sites add column if not exists longitude double precision;

-- Métriques météo journalières (Open-Meteo daily). NULL = non récupéré.
alter table public.site_day_log add column if not exists precipitation_mm   numeric;
alter table public.site_day_log add column if not exists wind_max_kmh       numeric;
alter table public.site_day_log add column if not exists temp_min           numeric;
alter table public.site_day_log add column if not exists temp_max           numeric;
-- Provenance : 'open-meteo' (ou null si météo saisie à la main).
alter table public.site_day_log add column if not exists weather_source     text;
alter table public.site_day_log add column if not exists weather_fetched_at timestamptz;

comment on column public.site_day_log.weather_source is
  'Provenance de la météo : ''open-meteo'' si récupérée par l''API (mig 161), null si saisie manuelle. Le drapeau intemperie reste TOUJOURS une décision humaine.';
comment on column public.sites.latitude is
  'Latitude du chantier (mig 161) pour la météo Open-Meteo. Saisie manuelle, opposable.';
