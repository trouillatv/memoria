-- 244 — CLASSIFIER UN AGENT INTERNE (Vincent, 2026-07-27)
--
-- Un « agent interne » est une personne métier de l'organisation qui travaille
-- sur le terrain SANS compte applicatif. Ce n'est PAS un rôle, ça n'accorde
-- aucun droit, ça n'implique aucun compte — c'est une CLASSIFICATION de la
-- personne (company_contacts), pour la distinguer d'un contact tiers.
--
-- On ne déduit JAMAIS « sans entreprise = agent interne » : un agent interne
-- peut être rattaché à une filiale/entité, et un contact externe peut ne pas
-- encore avoir d'entreprise. La distinction est donc explicite et portée ici.
--
-- `function` reste le MÉTIER (maçon, électricien, conducteur…) ; is_internal_agent
-- répond à « quel TYPE de personne » — les deux axes sont orthogonaux.
--
-- Additif et réversible : colonne booléenne NOT NULL DEFAULT false. Les contacts
-- existants restent des contacts (false), aucun back-fill destructif.

ALTER TABLE public.company_contacts
  ADD COLUMN IF NOT EXISTS is_internal_agent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_contacts.is_internal_agent IS
  'Classification métier (mig 244) : true = agent interne terrain de l''organisation. PAS un rôle, aucun droit, aucun compte. Orthogonal à function (le métier) et à company_id (optionnel).';

-- Retrouver rapidement les agents internes d'une organisation (répertoire, filtres).
CREATE INDEX IF NOT EXISTS company_contacts_internal_agent_idx
  ON public.company_contacts (organization_id)
  WHERE is_internal_agent = true AND deleted_at IS NULL;
