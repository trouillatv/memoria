-- Migration 123 — Réserve = mini-dossier : liens actions + documents.
--
-- La valeur n'est pas la réserve seule mais la CONTINUITÉ mémoire : qu'a-t-on
-- constaté, quelles actions, quels documents le justifiaient, comment c'est levé.
-- On relie donc la réserve à ses actions correctives et à ses documents, en
-- réutilisant l'infra existante. PAS de module OPR / réception (hors périmètre).

-- 1. Réserve ↔ actions correctives : une ou plusieurs actions contribuent à la
--    levée. FK nullable, on delete set null (supprimer une réserve ne supprime
--    jamais l'action — elle se « dé-rattache »).
alter table public.site_actions
  add column if not exists reserve_id uuid references public.site_reserve(id) on delete set null;

create index if not exists site_actions_reserve_idx
  on public.site_actions(reserve_id) where reserve_id is not null;

-- 2. Réserve ↔ documents : réutilise document_links. On ajoute 'reserve' aux
--    target_type autorisés (le CHECK inline de la mig 073 est nommé
--    document_links_target_type_check par convention Postgres).
alter table public.document_links drop constraint if exists document_links_target_type_check;
alter table public.document_links add constraint document_links_target_type_check
  check (target_type in (
    'contract','site','tender','client','intervention','team','tenant','reserve'));
