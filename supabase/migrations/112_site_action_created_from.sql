-- Provenance de création d'une action (2026-06-16)
--
-- Jusqu'ici une action ne pouvait naître que de la curation d'un compte-rendu
-- (report_id renseigné). On ouvre la création STANDALONE (capture terrain),
-- et on trace d'où elle naît pour l'observabilité « d'où viennent les actions ».
--
--   mobile_site   → ➕ Action depuis /m/site/[id] (capture chantier)
--   desktop_site  → ➕ Action depuis la fiche site /sites/[id]
--   actions_list  → ➕ Action depuis /actions
--   report        → issue d'un compte-rendu (non rétro-rempli ; NULL = legacy)
--
-- Nullable, pas de CHECK : on garde la liste ouverte pour de futures sources.

ALTER TABLE public.site_actions
  ADD COLUMN IF NOT EXISTS created_from text;

COMMENT ON COLUMN public.site_actions.created_from IS
  'Provenance de la création (mobile_site, desktop_site, actions_list, report…). NULL = legacy/compte-rendu. Observabilité, jamais affiché à l''utilisateur.';
