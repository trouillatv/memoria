-- Migration 205 — PL3b : la DÉCISION prise sur un conflit de fermeture.
--
-- PL3a constatait : « le site est fermé le 15, une prestation est prévue ».
-- Il ne proposait rien. Guillaume voyait le problème et allait le corriger
-- ailleurs, à la main, en devinant lui-même quelle date était libre.
--
-- PL3b lui donne cinq gestes — déplacer avant, déplacer après, choisir une
-- autre date, maintenir, annuler — et TRACE ce qu'il a choisi.
--
-- Pourquoi une TABLE, et pas un simple champ :
--
--   1. « MAINTENIR » doit survivre. L'intervention reste `planned` sur un jour
--      fermé : sans trace, le conflit se ré-affiche le lendemain matin, et le
--      surlendemain. Redemander tous les jours ce qui a DÉJÀ été tranché est le
--      meilleur moyen de faire ignorer les alertes — et le jour où une vraie
--      alerte arrive, plus personne ne la lit.
--
--   2. La décision se RELIT. « Pourquoi on est passé le 16 et pas le 15 ? » —
--      un an plus tard, la réponse doit exister. C'est de la mémoire, pas de la
--      configuration.
--
-- MemorIA NE DÉCIDE JAMAIS : il propose des dates ouvertes, l'humain tranche.
-- `decided_by` n'est pas un score : c'est la provenance de la décision, comme
-- partout ailleurs dans ce produit.
--
-- Une décision par (intervention, fermeture) : re-trancher REMPLACE (upsert).
-- Un changement d'avis n'est pas une faute — mais il écrase, il n'empile pas.
--
-- Idempotente. Rollback : DROP TABLE. Aucune donnée existante impactée : sans
-- décision enregistrée, le comportement est EXACTEMENT celui de PL3a.

create table if not exists public.closure_conflict_decision (
  id              uuid primary key default gen_random_uuid(),

  intervention_id uuid not null references public.interventions(id) on delete cascade,
  closure_id      uuid not null references public.site_closures(id) on delete cascade,

  -- Ce que l'humain a choisi.
  --   moved     : déplacée vers une date ouverte (`moved_to`) ;
  --   kept      : « on y va quand même » — le lieu est fermé au public, pas au
  --               prestataire. L'intervention reste planned, et cesse d'alerter ;
  --   cancelled : la prestation ne se fera pas (l'intervention passe `skipped`).
  decision        text not null check (decision in ('moved', 'kept', 'cancelled')),

  -- La date d'arrivée, si on a déplacé. NULL sinon.
  moved_to        date,

  -- La date du conflit d'origine — pour relire la décision sans reconstituer.
  conflict_date   date not null,

  decided_by      uuid references public.users(id) on delete set null,
  decided_at      timestamptz not null default now(),

  constraint closure_conflict_decision_moved_chk
    check ((decision = 'moved') = (moved_to is not null))
);

-- Une décision par conflit. Re-trancher remplace.
create unique index if not exists closure_conflict_decision_unique_idx
  on public.closure_conflict_decision (intervention_id, closure_id);

-- La lecture chaude : « quelles interventions ont été MAINTENUES ? » — c'est
-- elle qui court à chaque affichage de la semaine.
create index if not exists closure_conflict_decision_kept_idx
  on public.closure_conflict_decision (intervention_id)
  where decision = 'kept';

comment on table public.closure_conflict_decision is
  'PL3b — ce que l''humain a décidé face à un conflit « site fermé, prestation prévue ». MemorIA ne décide jamais : il propose, l''humain tranche, et la décision se relit un an plus tard.';
