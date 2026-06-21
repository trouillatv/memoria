-- S3-bis — Type d'action (Vincent 2026-06-21). Certaines actions ne sont pas
-- ponctuelles : « Fournir DOE », « Tenir le journal photo » restent ouvertes
-- jusqu'à la clôture du chantier. On ajoute un type à l'action ORDINAIRE :
--   one_shot              = ponctuelle (défaut, comportement actuel)
--   deadline              = à faire pour une échéance
--   recurring_until_done  = récurrente jusqu'à clôture (revient réunion après réunion)
--
-- Volontairement minimal (pas de planning, pas de Gantt). Le cycle reste
-- ouvert / à relancer / fait / clôturé via `status`. Distinct des OBLIGATIONS
-- (mig 146, objet prescriptif curé) : ici c'est un attribut d'action libre.

ALTER TABLE public.site_actions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'one_shot'
    CHECK (kind IN ('one_shot', 'deadline', 'recurring_until_done'));

COMMENT ON COLUMN public.site_actions.kind IS
  'Type d''action (mig 149) : one_shot (ponctuelle) | deadline (pour une échéance) | recurring_until_done (récurrente jusqu''à clôture). Pas de planning — juste la nature.';
