-- Fin de vie d'une échéance VALIDÉE (Vincent, 2026-07-28).
--
-- On distingue deux mondes qu'on ne doit jamais confondre :
--   · le REJET d'une proposition (avant validation) vit sur la proposition
--     (site_knowledge_proposals.status = 'dismissed') — c'est le futur centre
--     de validation IA qui le montrera ;
--   · l'ANNULATION d'une échéance déjà validée vit ICI. L'échéance avait été
--     acceptée, elle n'est plus pertinente — décision humaine, jamais un oubli.
--
-- On NE crée PAS d'état « périmé » : une échéance planned dont la date est passée
-- reste due — « En retard » est un état CALCULÉ (planned + date dépassée), pas un
-- statut stocké. Une obligation ne disparaît pas parce que sa date est passée.
--
-- Additif : nouvelles colonnes nullables + un statut de plus ('superseded').
-- On garde 'done' (déjà = réalisée) comme statut « réalisée » — pas de renommage.

ALTER TABLE public.site_deadlines
  DROP CONSTRAINT IF EXISTS site_deadlines_status_check;
ALTER TABLE public.site_deadlines
  ADD CONSTRAINT site_deadlines_status_check
  CHECK (status IN ('to_plan', 'planned', 'done', 'cancelled', 'superseded'));

ALTER TABLE public.site_deadlines
  -- Réalisée : qui, quand.
  ADD COLUMN IF NOT EXISTS completed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Annulée / remplacée : qui, quand, pourquoi.
  ADD COLUMN IF NOT EXISTS cancelled_at   timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason  text,
  ADD COLUMN IF NOT EXISTS cancel_comment text,
  -- Remplacée PAR quelle échéance (statut 'superseded').
  ADD COLUMN IF NOT EXISTS superseded_by  uuid REFERENCES public.site_deadlines(id) ON DELETE SET NULL;

ALTER TABLE public.site_deadlines
  DROP CONSTRAINT IF EXISTS site_deadlines_cancel_reason_check;
ALTER TABLE public.site_deadlines
  ADD CONSTRAINT site_deadlines_cancel_reason_check
  CHECK (cancel_reason IS NULL OR cancel_reason IN (
    'abandoned',        -- travaux abandonnés
    'superseded',       -- remplacée par une autre échéance
    'done_otherwise',   -- déjà réalisée autrement
    'bad_extraction',   -- mauvaise extraction
    'not_needed',       -- plus nécessaire
    'other'             -- autre (voir cancel_comment)
  ));

COMMENT ON COLUMN public.site_deadlines.cancel_reason IS
  'Motif d''annulation APRÈS validation (distinct du rejet d''une proposition). abandoned=travaux abandonnés · superseded=remplacée par une autre échéance · done_otherwise=déjà réalisée autrement · bad_extraction=mauvaise extraction · not_needed=plus nécessaire · other=autre (cancel_comment).';
COMMENT ON COLUMN public.site_deadlines.superseded_by IS
  'L''échéance qui remplace celle-ci (statut superseded). Le « lien vers la nouvelle échéance » du bloc Pourquoi ?.';
