-- ============================================================================
-- Migration 025 — teams.referent_user_id (Phase 10 — Doctrine V3)
-- ============================================================================
--
-- Désigne un POINT DE CONTACT STABLE pour une équipe. Distinct du référent
-- per-intervention (cf. intervention_participants.role = 'referent').
--
-- Doctrine V3 :
--   ✅ Désignation organisationnelle ("qui contacter pour cette équipe ?")
--   ❌ JAMAIS une hiérarchie ni une mesure de performance
--   ❌ Le mot "chef d'équipe" reste un RÔLE UTILISATEUR (role enum), pas une
--      désignation au sein d'une team. On utilise "référent" pour rester
--      cohérent avec V3 et éviter le double sens.
--
-- Contrainte d'intégrité optionnelle (volontairement NON ajoutée) :
--   "Le référent doit être membre actif de la team" → non enforced en DB pour
--   tolérer les transitions (départ du référent sans remplaçant immédiat).
--   L'UI doit alerter mais ne pas bloquer.

alter table public.teams
  add column referent_user_id uuid
    references public.users(id) on delete set null;

comment on column public.teams.referent_user_id is
  'Doctrine V3 — Référent d''équipe : point de contact opérationnel stable. '
  'Distinct de intervention_participants.role=''referent'' (per-événement). '
  'on delete set null : si le référent disparaît (RGPD), la team subsiste.';

-- Index : utilisé pour la jointure "équipes dont user X est référent" — sert
-- uniquement à l'affichage côté /equipes, pas à du reverse-lookup analytique.
create index idx_teams_referent_user_id
  on public.teams(referent_user_id)
  where referent_user_id is not null;
