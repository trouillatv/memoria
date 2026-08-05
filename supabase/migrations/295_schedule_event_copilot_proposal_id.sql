-- Mig 295 — Copilote : idempotence sur site_scheduled_events.
--
-- Ajoute copilot_proposal_id (uuid unique) pour qu'un double-clic sur "Valider"
-- dans le Copilote ne crée jamais deux rendez-vous identiques.
-- Même mécanique que site_actions.copilot_proposal_id (mig 293).

ALTER TABLE public.site_scheduled_events
  ADD COLUMN IF NOT EXISTS copilot_proposal_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS site_scheduled_events_copilot_proposal_id_key
  ON public.site_scheduled_events (copilot_proposal_id)
  WHERE copilot_proposal_id IS NOT NULL;
