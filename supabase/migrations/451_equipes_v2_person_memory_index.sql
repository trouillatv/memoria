-- ============================================================================
-- Migration 451 — /EQUIPES V2 : index reverse-lookup intervention_participants.user_id
-- ============================================================================
--
-- Migration 024 avait délibérément omis cet index comme « marqueur doctrinal
-- anti reverse-lookup » (Doctrine V3 : jamais de lecture user_id → events).
--
-- Doctrine V4 (GO Vincent, /EQUIPES V2 — WOW PERSONNE) lève cette interdiction
-- pour un seul usage : construire la mémoire d'une personne à partir de ses
-- participations CONFIRMÉES (lib/db/person-memory.ts). Le classement, la
-- performance et la disponibilité restent interdits (doctrine inchangée sur
-- ce point, cf. tests/doctrine/forbidden-symbols.test.ts).
--
-- Additive uniquement : aucune donnée modifiée, aucune contrainte retirée.

create index if not exists idx_intervention_participants_user_id
  on public.intervention_participants(user_id);

comment on index public.idx_intervention_participants_user_id is
  'Doctrine V4 — reverse lookup autorisé uniquement pour la mémoire Personne '
  'confirmée (lib/db/person-memory.ts). Ne sert jamais au classement, à la '
  'performance ou à la disponibilité.';
