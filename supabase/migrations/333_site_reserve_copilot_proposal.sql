-- P4-E3 (CREATE_RESERVE) — idempotence Copilote sur site_reserve.
-- (Vincent, 2026-08-17.) Additive uniquement : colonne nullable + index unique
-- partiel, même schéma que 331 (watchpoints) et 332 (deadlines).

alter table public.site_reserve add column if not exists copilot_proposal_id uuid;

comment on column public.site_reserve.copilot_proposal_id is
  'ID de la proposition Copilote à l''origine de cette réserve (idempotence — rejouer la même proposition ne crée pas de doublon).';

create unique index if not exists site_reserve_copilot_proposal_id_key
  on public.site_reserve (copilot_proposal_id) where copilot_proposal_id is not null;

alter table public.copilot_interactions drop constraint if exists copilot_proposal_kind_chk;
alter table public.copilot_interactions add constraint copilot_proposal_kind_chk check (
  proposal_kind is null or proposal_kind in (
    'action', 'visit_item', 'schedule_visit', 'schedule_meeting', 'observation',
    'actor_alias', 'fact', 'relation_claim', 'watchpoint', 'deadline', 'reserve'
  )
);
