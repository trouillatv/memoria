-- Migration 062 : identité canonique des sites
-- Ajoute normalized_name + canonical_site_key pour détecter les doublons.
-- pg_trgm permet la similarité trigram (similarity()) utilisée en backfill.
-- Un trigger maintient normalized_name automatiquement à chaque insert/update.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Colonnes
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS normalized_name text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS canonical_site_key text;

-- Trigger function : calcule normalized_name depuis name.
-- Lowercase + unaccent + tirets → espace + collapse espaces.
CREATE OR REPLACE FUNCTION public.sites_compute_normalized()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.normalized_name := trim(regexp_replace(
    regexp_replace(
      lower(unaccent(trim(NEW.name))),
      '[-–—_]+', ' ', 'g'
    ),
    '\s+', ' ', 'g'
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sites_normalize_name ON public.sites;
CREATE TRIGGER sites_normalize_name
  BEFORE INSERT OR UPDATE OF name ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.sites_compute_normalized();

-- Backfill normalized_name pour les lignes existantes
UPDATE public.sites
SET normalized_name = trim(regexp_replace(
  regexp_replace(
    lower(unaccent(trim(name))),
    '[-–—_]+', ' ', 'g'
  ),
  '\s+', ' ', 'g'
))
WHERE normalized_name IS NULL;

-- Backfill canonical_site_key : normalized_client::normalized_site
-- Pour les sites liés à un client
UPDATE public.sites s
SET canonical_site_key = CONCAT(
  trim(regexp_replace(regexp_replace(lower(unaccent(trim(c.name))), '[-–—_]+', ' ', 'g'), '\s+', ' ', 'g')),
  '::',
  s.normalized_name
)
FROM public.clients c
WHERE s.client_id = c.id
  AND s.canonical_site_key IS NULL;

-- Pour les sites sans client
UPDATE public.sites
SET canonical_site_key = CONCAT('inconnu::', normalized_name)
WHERE canonical_site_key IS NULL;

-- Index GIN trigram pour la recherche de similarité rapide
CREATE INDEX IF NOT EXISTS sites_normalized_name_trgm_idx
  ON public.sites USING gin (normalized_name gin_trgm_ops)
  WHERE deleted_at IS NULL;
