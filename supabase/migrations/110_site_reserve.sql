-- Réserves / levée de réserves (2026-06-15) — Tier 1 BTP.
--
-- À la réception des travaux (OPR), le maître d'œuvre (MOE) dresse la liste des
-- RÉSERVES : défauts constatés à corriger ("fissure mur axe 4", "porte qui
-- frotte"). L'entreprise doit les LEVER une à une — avec preuve (photo) et date.
-- Tant que les réserves ne sont pas levées, la réception n'est pas prononcée /
-- la retenue de garantie n'est pas libérée.
--
-- Une réserve est SITE-scoped (rattachée au lieu, pas à une intervention),
-- émise par la MOE, et porte une photo avant/après et une levée datée.
--
-- Doctrine MemorIA : descriptif, niveau SITE, calme (pas d'alerte rouge).
-- VOCABULAIRE JURIDIQUE : status 'lifted' = "Levée" ; on ne dit JAMAIS
-- "résolu" (terme juridiquement dangereux). On dit "levée" / "clôturée".
-- NO RLS (server actions via admin client, comme les autres tables site_*).

CREATE TABLE IF NOT EXISTS public.site_reserve (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  organization_id     uuid,

  -- Libellé de la réserve, tel que dressé par la MOE (ex. "fissure mur axe 4").
  label               text NOT NULL,
  -- Zone / ouvrage concerné (ex. "RDC — hall", "façade nord").
  location            text,
  -- Émetteur de la réserve (ex. "MOE", "architecte", nom du bureau de contrôle).
  issued_by           text,
  -- Date à laquelle la réserve a été émise (OPR / PV de réception).
  issued_on           date,

  -- 'open'   = réserve ouverte, à lever.
  -- 'lifted' = réserve LEVÉE (jamais "résolu") — preuve + date renseignées.
  status              text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'lifted')),

  -- Preuve photographique : état initial (constat) et état après levée.
  photo_before_path   text,
  photo_after_path    text,

  -- Levée : date opposable + note de levée (ce qui a été fait).
  lifted_at           timestamptz,
  lift_note           text,

  created_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_reserve_site_status_idx
  ON public.site_reserve (site_id, status);

COMMENT ON TABLE public.site_reserve IS
  'Réserves d''un site (OPR / réception BTP). Défauts dressés par la MOE, à LEVER avec preuve et date. status lifted = "levée" (jamais "résolu"). Site-scoped.';
COMMENT ON COLUMN public.site_reserve.label IS
  'Libellé de la réserve dressée par la MOE (ex. "fissure mur axe 4").';
COMMENT ON COLUMN public.site_reserve.location IS
  'Zone / ouvrage concerné (ex. "RDC — hall", "façade nord").';
COMMENT ON COLUMN public.site_reserve.issued_by IS
  'Émetteur de la réserve (MOE, architecte, bureau de contrôle…).';
COMMENT ON COLUMN public.site_reserve.issued_on IS
  'Date d''émission de la réserve (OPR / PV de réception).';
COMMENT ON COLUMN public.site_reserve.status IS
  'open = ouverte à lever ; lifted = LEVÉE (jamais "résolu"). Une réserve clôturée est dite "levée".';
COMMENT ON COLUMN public.site_reserve.photo_before_path IS
  'Chemin storage (bucket intervention-photos) de la photo de constat (avant).';
COMMENT ON COLUMN public.site_reserve.photo_after_path IS
  'Chemin storage (bucket intervention-photos) de la photo de preuve de levée (après).';
COMMENT ON COLUMN public.site_reserve.lifted_at IS
  'Horodatage de la levée — preuve datée opposable. NULL tant que status = open.';
COMMENT ON COLUMN public.site_reserve.lift_note IS
  'Note de levée : ce qui a été fait pour lever la réserve.';
