-- Chantier de recette (2026-07-17) — un terrain de validation PERMANENT.
--
-- Pourquoi une colonne et pas une convention de nom ? Parce que le bouton
-- « Réinitialiser le chantier » SUPPRIME des données. Reconnaître le bac à sable à
-- son nom (« 🧪 Recette ») laisserait un chantier réel se faire vider par un
-- renommage ou un homonyme. Le droit d'être réinitialisé est une propriété du
-- chantier, portée par la base, pas une chaîne de caractères dans un libellé.
--
-- Fail-closed : `false` par défaut. Un chantier ne devient un bac à sable que si
-- quelqu'un l'a explicitement décidé ; l'oubli n'ouvre jamais la porte.
--
-- Additive et réversible : aucune donnée existante n'est touchée.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS is_sandbox boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sites.is_sandbox IS
  'Chantier de recette : seul un chantier marqué ici peut être réinitialisé (suppression de ses visites, actions, propositions, réserves). Jamais vrai sur un chantier client.';

-- Un index partiel : on ne cherche QUE les rares bacs à sable, jamais l''inverse.
CREATE INDEX IF NOT EXISTS sites_is_sandbox_idx
  ON public.sites (organization_id)
  WHERE is_sandbox = true;
