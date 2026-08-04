-- 293 — Colonnes de provenance Copilote 3C sur site_actions.
--
-- Objectif : tracer les actions créées via le Copilote avec confirmation humaine.
-- Principe « IA propose, humain valide » : aucune écriture sans confirmed_by.
--
-- copilot_proposal_id : clé d'idempotence (UNIQUE non null) — empêche de confirmer
--   deux fois la même proposition sans recourir à un état client.
-- confirmed_by / confirmed_at : qui a validé et quand.
-- llm_model / prompt_version : traçabilité du modèle et de la version de prompt utilisés.
--
-- Rollback : ALTER TABLE DROP COLUMN + DROP INDEX.

ALTER TABLE public.site_actions
  ADD COLUMN IF NOT EXISTS copilot_proposal_id uuid,
  ADD COLUMN IF NOT EXISTS confirmed_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS llm_model           text,
  ADD COLUMN IF NOT EXISTS prompt_version      text;

-- Contrainte d'idempotence : une proposition ne peut créer qu'une seule action.
CREATE UNIQUE INDEX IF NOT EXISTS site_actions_copilot_proposal_id_key
  ON public.site_actions (copilot_proposal_id)
  WHERE copilot_proposal_id IS NOT NULL;

COMMENT ON COLUMN public.site_actions.copilot_proposal_id IS
  'Clé d''idempotence Copilote 3C (mig 293). UNIQUE : une proposition = au plus une action.';
COMMENT ON COLUMN public.site_actions.confirmed_by IS
  'Utilisateur ayant confirmé la proposition copilote (mig 293).';
COMMENT ON COLUMN public.site_actions.confirmed_at IS
  'Horodatage de la confirmation humaine (mig 293).';
COMMENT ON COLUMN public.site_actions.llm_model IS
  'Modèle LLM utilisé lors de la classification (mig 293).';
COMMENT ON COLUMN public.site_actions.prompt_version IS
  'Version du prompt de classification (mig 293).';
