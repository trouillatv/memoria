-- Journal de chantier — météo / intempéries du jour (2026-06-15, Tier 1 BTP)
--
-- Le journal du site est aujourd'hui dérivé des seules interventions. Or un
-- JOUR D'INTEMPÉRIE (pluie, vent, orage) où PERSONNE ne travaille n'apparaît
-- nulle part — c'est pourtant LA preuve qui défend l'entreprise contre les
-- pénalités de retard sur un marché public.
--
-- `site_day_log` = une entrée par site et par jour : météo + drapeau intempérie
-- + note courte. Daté, opposable. Doctrine : descriptif, niveau SITE (jamais
-- une mesure d'humain). Sécurité : admin client + scoping `organization_id`.

CREATE TABLE IF NOT EXISTS public.site_day_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  organization_id uuid,
  log_date        date NOT NULL,
  weather         text CHECK (weather IN (
                    'clear', 'cloudy', 'rain', 'heavy_rain', 'wind', 'storm', 'heat', 'other'
                  )),
  intemperie      boolean NOT NULL DEFAULT false,
  note            text,
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Une seule entrée météo par site et par jour (upsert).
  UNIQUE (site_id, log_date)
);

CREATE INDEX IF NOT EXISTS site_day_log_site_date_idx
  ON public.site_day_log (site_id, log_date DESC);

COMMENT ON TABLE public.site_day_log IS
  'Météo/intempérie du jour par site (journal de chantier). Descriptif, niveau site, jamais une mesure d''humain. Preuve datée anti-pénalités.';
COMMENT ON COLUMN public.site_day_log.intemperie IS
  'true = journée d''intempérie (travaux empêchés). Sert de preuve opposable face aux pénalités de retard.';
