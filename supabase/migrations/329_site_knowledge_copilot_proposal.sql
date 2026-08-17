-- 329 — copilot_proposal_id sur site_knowledge_entries + intent FACT (P4-C).
--
-- FACT (cadrage Vincent 2026-08-17) : phrases déclaratives qui apportent une
-- information à retenir sans être une question, une action, un constat
-- d'état terrain, une correction d'identité, une relation structurée ou une
-- planification. Écrit DIRECTEMENT dans site_knowledge_entries (kind=knowledge
-- existant), jamais via site_knowledge_proposals — cette dernière reste
-- réservée aux propositions issues de l'analyse asynchrone de visite.
--
-- Idempotence : même mécanique que actor_alias.copilot_proposal_id (mig 327)
-- et site_actions.copilot_proposal_id (mig 293) — clé générée côté client à
-- l'affichage du brouillon, pas une FK, index unique partiel pour absorber le
-- double-clic "Valider" sans doublon.
--
-- La nature (current_information / durable_knowledge) reste choisie par
-- l'humain, jamais déduite par le LLM — déjà garanti par kind NOT NULL sans
-- défaut (mig 218) ; ce n'est pas une contrainte nouvelle, seulement rappelé
-- ici pour mémoire du choix produit.

alter table public.site_knowledge_entries
  add column if not exists copilot_proposal_id uuid;

comment on column public.site_knowledge_entries.copilot_proposal_id is
  'Clé d''idempotence générée côté client à l''affichage du brouillon FACT (même mécanique que actor_alias.copilot_proposal_id, mig 327) — pas une FK.';

create unique index if not exists site_knowledge_entries_copilot_proposal_id_key
  on public.site_knowledge_entries (copilot_proposal_id)
  where copilot_proposal_id is not null;

-- Élargit la contrainte posée en mig 294, déjà étendue en mig 328, pour
-- accepter 'fact' — même défaut silencieux à éviter que documenté en 328
-- (logCopilotInteraction est best-effort).

alter table public.copilot_interactions
  drop constraint if exists copilot_proposal_kind_chk;

alter table public.copilot_interactions
  add constraint copilot_proposal_kind_chk check (
    proposal_kind is null or proposal_kind in (
      'action', 'visit_item', 'schedule_visit', 'schedule_meeting', 'observation', 'actor_alias', 'fact'
    )
  );
