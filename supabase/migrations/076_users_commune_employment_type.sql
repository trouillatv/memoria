-- 076 — Champs intervenant : commune de résidence + type de contrat
--
-- Vincent 2026-05-21 : permettre au manager de créer un nouvel intervenant
-- depuis /intervenants avec ses infos opérationnelles.
--
-- Doctrine MemorIA (cf. memory project-name + refus-erp-rh-pointage-gps) :
--   - commune : utilisée pour l'AFFECTATION OPÉRATIONNELLE par le manager
--     (ex. agent qui habite Païta peut bosser sur Païta), JAMAIS comme
--     filtre auto / scoring trajet / surveillance.
--   - employment_type : enum sobre (CDI/CDD/CDI Chantier). NON COMPARATIF
--     côté UI — affiché factuellement, jamais en classement, jamais en
--     filtre « CDI prioritaire » ou similaire.

CREATE TYPE employment_type AS ENUM ('cdi', 'cdd', 'cdi_chantier');

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS commune          text,
  ADD COLUMN IF NOT EXISTS employment_type  employment_type;

COMMENT ON COLUMN public.users.commune IS
  'Commune de résidence (optionnel). Vincent 2026-05-21 — usage : affectation manuelle. Pas de filtre auto / scoring.';

COMMENT ON COLUMN public.users.employment_type IS
  'Type de contrat (cdi / cdd / cdi_chantier). Vincent 2026-05-21 — usage : information structurelle non comparative. JAMAIS classement.';
