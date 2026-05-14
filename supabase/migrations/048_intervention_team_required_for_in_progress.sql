-- Garde-fou DB : une intervention ne peut PAS être in_progress / completed /
-- validated sans assigned_team_id. C'est cohérent avec la doctrine V3 qui
-- veut une "organisation prévue" avant l'exécution.
--
-- Côté code, le check est déjà fait dans start_intervention_action(s) (mobile
-- + superviseur). Cette contrainte DB est un filet de sécurité contre les
-- futurs migrations, scripts dev ou updates manuels qui pourraient laisser
-- une intervention dans un état orphelin (in_progress + null team).
--
-- Avant d'ajouter la contrainte, on a vérifié qu'il n'y a plus aucune
-- intervention dans cet état (script scripts/dev/check-intervention.ts).
-- L'état orphelin précédemment trouvé a été corrigé manuellement.

ALTER TABLE public.interventions
  ADD CONSTRAINT chk_active_intervention_requires_team
  CHECK (
    status NOT IN ('in_progress', 'completed', 'validated')
    OR assigned_team_id IS NOT NULL
  );

COMMENT ON CONSTRAINT chk_active_intervention_requires_team ON public.interventions IS
  'Doctrine V3 : impossible de démarrer/terminer/valider une intervention sans équipe affectée (organisation prévue requise avant exécution).';
