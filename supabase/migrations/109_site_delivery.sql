-- Bons de livraison de chantier (Tier 1 BTP) — 2026-06-15
--
-- Un chantier reçoit des livraisons : béton/BPE, matériaux, le camion qui livre.
-- Chaque livraison est enregistrée avec une photo du bon de livraison (BL),
-- datée et OPPOSABLE : preuve décennale / contentieux (qui a livré quoi, quand,
-- sur quelle zone/ouvrage).
--
-- Doctrine : descriptif, niveau SITE, calme (pas d'alerte rouge), jamais une
-- mesure d'humain. Sécurité : pas de RLS — applicatif via admin client + scoping
-- `organization_id` (comme les autres helpers de site).
--
-- La photo du BL est stockée dans le bucket existant `intervention-photos`
-- (préfixe `site-deliveries/<id>/`) ; seul le chemin est conservé en base.

CREATE TABLE IF NOT EXISTS public.site_delivery (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  organization_id   uuid,

  delivered_on      date NOT NULL,        -- date de la livraison (valeur opposable)
  supplier          text,                 -- fournisseur (ex. centrale BPE, négoce)
  reference         text,                 -- n° du bon de livraison
  zone              text,                 -- ouvrage / zone du chantier concerné
  material          text,                 -- matériau livré (béton C25/30, ferraille…)
  quantity          text,                 -- quantité (texte libre : « 12 m³ », « 3 palettes »)
  photo_path        text,                 -- chemin du BL dans `intervention-photos`
  note              text,

  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_delivery_site_date_idx
  ON public.site_delivery (site_id, delivered_on DESC);

COMMENT ON TABLE public.site_delivery IS
  'Bons de livraison d''un chantier : béton/BPE, matériaux. Photo du BL datée et opposable (preuve décennale / contentieux). Niveau site, descriptif.';
COMMENT ON COLUMN public.site_delivery.delivered_on IS
  'Date de la livraison — valeur juridique opposable.';
COMMENT ON COLUMN public.site_delivery.reference IS
  'Numéro du bon de livraison fournisseur.';
COMMENT ON COLUMN public.site_delivery.zone IS
  'Ouvrage / zone du chantier concerné par la livraison.';
COMMENT ON COLUMN public.site_delivery.photo_path IS
  'Chemin de la photo du bon de livraison dans le bucket intervention-photos.';
