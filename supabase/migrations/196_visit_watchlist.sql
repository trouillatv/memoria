-- 196 — « À vérifier » : la liste de questions de contrôle d'UNE visite.
--
-- PAS un nouvel objet métier (pas une Tâche) : un ARTEFACT DE SESSION rattaché
-- à la visite (report), au cycle de vie court :
--   préparée (seed déterministe au démarrage, depuis les signaux mémoire + le
--   motif) → utilisée pendant (3 états) → soldée au débrief → conservée dans
--   la mémoire de la visite. Jamais rejointe à la liste générale des actions.
--
-- États : 'pending' (pas encore statué — jamais montré comme « non vérifié »,
-- culpabilisant) | 'verified' (Vérifié) | 'to_follow' (À suivre — promotion
-- MANUELLE possible en action/réserve, jamais automatique) | 'dismissed'
-- (Sans objet).
--
-- Provenance (explicabilité, jamais inventée) : source_kind = le détecteur
-- déterministe (reserve_open, action_overdue…) ou 'manual' ; source_ref = l'id
-- de l'objet source. Zéro IA.
--
-- Rollback : DROP TABLE. Aucune donnée existante impactée.

create table if not exists public.visit_watchlist_item (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references public.site_reports(id) on delete cascade,
  site_id         uuid not null references public.sites(id) on delete cascade,
  organization_id uuid,
  label           text not null,
  position        int  not null default 0,
  state           text not null default 'pending'
    check (state in ('pending', 'verified', 'to_follow', 'dismissed')),
  -- Constat court facultatif posé en cochant (« odeur toujours présente »).
  note            text,
  source_kind     text,
  source_ref      text,
  -- Rattachement facultatif d'une capture de la visite au point.
  capture_id      uuid references public.visit_capture(id) on delete set null,
  -- Promotion MANUELLE d'un « à suivre » en objet chantier (traçabilité).
  promoted_to     text check (promoted_to is null or promoted_to in ('action', 'reserve')),
  promoted_ref    uuid,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists visit_watchlist_item_report_idx
  on public.visit_watchlist_item (report_id);

comment on table public.visit_watchlist_item is
  'Liste « À vérifier » d''une visite (mig 196) — artefact de session, jamais un objet métier. Seed déterministe (signaux + motif), 3 états, promotion manuelle.';
