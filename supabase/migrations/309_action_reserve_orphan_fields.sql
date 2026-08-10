-- Traçabilité des objets matérialisés devenus orphelins après ré-analyse d'une visite.
--
-- Quand une proposition (status='proposed') passe en 'superseded' lors d'une ré-analyse,
-- les objets qu'elle avait générés (site_action, site_reserve) peuvent se retrouver sans
-- proposition active qui les porte. S'ils n'ont pas été touchés par un humain
-- (= encore "sous contrôle de la visite"), on les marque orphelins plutôt que de les
-- laisser silencieusement détachés.
--
-- orphaned_from_visit_at  : horodatage du moment où l'objet est devenu orphelin.
-- orphaned_from_visit_reason : raison bornée (ex. 'source_superseded_no_replacement').

ALTER TABLE public.site_actions
  ADD COLUMN IF NOT EXISTS orphaned_from_visit_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS orphaned_from_visit_reason TEXT;

ALTER TABLE public.site_reserve
  ADD COLUMN IF NOT EXISTS orphaned_from_visit_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS orphaned_from_visit_reason TEXT;
