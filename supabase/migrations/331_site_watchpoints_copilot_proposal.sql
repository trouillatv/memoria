-- P4-E1 CREATE_WATCHPOINT — idempotence Copilote sur site_watchpoints.
-- Même mécanique que actor_alias.copilot_proposal_id (mig 327),
-- site_knowledge_entries.copilot_proposal_id (mig 329) et
-- canonical_subject_links.copilot_proposal_id (mig 330) : colonne additive
-- nullable, PAS une FK, générée côté client à l'affichage du brouillon.

alter table public.site_watchpoints
  add column if not exists copilot_proposal_id uuid;

comment on column public.site_watchpoints.copilot_proposal_id is
  'Clé d''idempotence générée côté client à l''affichage du brouillon CREATE_WATCHPOINT (même mécanique que actor_alias.copilot_proposal_id, mig 327 ; site_knowledge_entries.copilot_proposal_id, mig 329 ; canonical_subject_links.copilot_proposal_id, mig 330) — pas une FK.';

create unique index if not exists site_watchpoints_copilot_proposal_id_key
  on public.site_watchpoints (copilot_proposal_id)
  where copilot_proposal_id is not null;

alter table public.copilot_interactions
  drop constraint if exists copilot_proposal_kind_chk;

alter table public.copilot_interactions
  add constraint copilot_proposal_kind_chk check (
    proposal_kind is null or proposal_kind in (
      'action', 'visit_item', 'schedule_visit', 'schedule_meeting', 'observation', 'actor_alias', 'fact', 'relation_claim', 'watchpoint'
    )
  );
