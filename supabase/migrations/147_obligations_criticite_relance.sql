-- Obligations — Sprint B1 de consolidation (2026-06-21, retour Vincent).
--
-- Risque identifié : sans hiérarchie, le briefing devient illisible (25 signaux).
-- On ajoute la CRITICITÉ (tri du briefing) + de quoi enrichir la cause de la
-- négligence (dernière relance). responsible = déjà éditable (responsible_role).

ALTER TABLE public.obligation_template
  ADD COLUMN IF NOT EXISTS importance text NOT NULL DEFAULT 'moyenne'
    CHECK (importance IN ('critique', 'haute', 'moyenne'));

ALTER TABLE public.site_obligation
  ADD COLUMN IF NOT EXISTS importance text NOT NULL DEFAULT 'moyenne'
    CHECK (importance IN ('critique', 'haute', 'moyenne'));

-- Dernière relance émise (cause enrichie : « relancé le 12/06, aucune réponse »).
ALTER TABLE public.site_obligation
  ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;

-- Criticité par défaut de la bibliothèque VRD (table Vincent).
UPDATE public.obligation_template SET importance = 'critique'
  WHERE organization_id IS NULL AND code = 'dict';
UPDATE public.obligation_template SET importance = 'haute'
  WHERE organization_id IS NULL AND code IN ('doe', 'recolement', 'essais_plaque', 'controles_enrobes', 'paq');
UPDATE public.obligation_template SET importance = 'moyenne'
  WHERE organization_id IS NULL AND code IN ('journal_photo', 'fiches_techniques');

COMMENT ON COLUMN public.site_obligation.importance IS
  'critique | haute | moyenne — pilote le TRI du briefing (sinon illisible). Pas un score d''acteur.';
COMMENT ON COLUMN public.site_obligation.last_reminded_at IS
  'Dernière relance émise — enrichit la cause de la négligence (« relancé le …, sans réponse »).';
