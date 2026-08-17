-- 328 — élargit copilot_proposal_kind_chk (P4-B.2).
--
-- La contrainte posée en mig 294 n'autorisait que ('action', 'visit_item').
-- Depuis, le code (copilot-proposal.ts) produit aussi 'schedule_visit',
-- 'schedule_meeting', 'observation' — leur `proposal_kind` échouait donc
-- silencieusement à l'insertion (logCopilotInteraction est best-effort, cf.
-- lib/db/copilot-telemetry.ts) : découverte incidente en implémentant
-- CORRECTION_IDENTITY ('actor_alias'), corrigée ici avec elle puisque c'est
-- exactement la même contrainte.

alter table public.copilot_interactions
  drop constraint if exists copilot_proposal_kind_chk;

alter table public.copilot_interactions
  add constraint copilot_proposal_kind_chk check (
    proposal_kind is null or proposal_kind in (
      'action', 'visit_item', 'schedule_visit', 'schedule_meeting', 'observation', 'actor_alias'
    )
  );
