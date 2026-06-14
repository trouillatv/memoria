-- Compte-rendu = assistant de réunion de chantier (2026-06-15)
--
-- Passage de "moteur de résumé" à "moteur de mémoire opérationnelle" :
-- l'écran d'analyse reconstruit la réunion (présents, corps d'état, décisions,
-- risques, comparaison avec la réunion précédente, plan de demain).
--
-- Additif à la migration 099 (déjà appliquée). On stocke sur le compte-rendu
-- les éléments de reconstruction proposés par l'IA — l'humain les valide.

-- Présents détectés (personnes + entreprises + contrôle). Coordination
-- descriptive, jamais score/jugement par personne.
-- Forme : [{ "name": "...", "role": "Plomberie"|null, "kind": "person"|"company"|"control"|"other" }]
ALTER TABLE public.site_reports
  ADD COLUMN IF NOT EXISTS participants jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Risques & dépendances proposés (rôle conducteur de travaux assistant).
-- Forme : [{ "kind": "dependency"|"preparation"|"vigilance"|"risk", "label": "...", "rationale": "..." }]
ALTER TABLE public.site_reports
  ADD COLUMN IF NOT EXISTS risks jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.site_reports.participants IS
  'Présents détectés par l''IA (personnes/entreprises/contrôle). Coordination descriptive validée par l''humain, jamais score par personne.';
COMMENT ON COLUMN public.site_reports.risks IS
  'Risques & dépendances proposés par l''IA (conducteur de travaux assistant). Inférence faillible, jamais auto-appliquée.';
