-- Migration 224 — Télémétrie de VALEUR des résultats IA (lot 5.1A-1).
--
-- `ai_usage` répond « l'IA a-t-elle tourné ? ». `usage_events` répond « quelle
-- partie de l'app est utilisée ? ». Aucune des deux ne répond « le résultat de
-- l'IA a-t-il aidé le conducteur à faire son travail ? ». Cette migration ouvre
-- la place pour cette troisième mesure, DANS `usage_events`, sans nouvelle table.
--
-- ── CE QUI EST MESURÉ, ET CE QUI NE L'EST JAMAIS ─────────────────────────────
-- Doctrine (docs/superpowers/doctrines/metriques-refletent-la-causalite.md) :
--   · on mesure QUELLE capacité sert, JAMAIS qui l'utilise → aucune de ces
--     colonnes ne porte d'identité de personne, et le contrat `trackAiOutcome`
--     n'écrit jamais `user_id` (verrouillé par test d'invariant) ;
--   · aucune donnée métier : pas de texte de résumé, pas de titre d'action —
--     seulement des dimensions FERMÉES et des nombres. `edit_ratio` est calculé
--     à la validation ; les deux textes ne sont jamais stockés ;
--   · le résumé et la proposition sont DEUX capacités distinctes. Le schéma ne
--     porte AUCUN lien de l'une vers l'autre : une action promue n'est pas une
--     conséquence démontrée du résumé.
--
-- Additive et idempotente. Toutes colonnes nullables : les événements d'usage
-- existants (mig 113) gardent `outcome = NULL` et ne sont pas concernés.

alter table public.usage_events
  -- La capacité IA observée. Vocabulaire FERMÉ (miroir du type `AiCapability`).
  add column if not exists ai_capability   text,
  -- Le devenir du résultat. Vocabulaire FERMÉ (miroir du type `AiOutcome`).
  add column if not exists ai_outcome       text,
  -- La nature de l'artefact (compte-rendu, proposition…). Vocabulaire FERMÉ.
  add column if not exists ai_artifact_type text,
  -- L'artefact concerné : nécessaire pour relier les étapes d'une même chaîne et
  -- dédupliquer. ⚠️ JAMAIS exposé dans la lecture agrégée (réidentification
  -- indirecte en petite organisation) — c'est une clé technique, pas une dimension.
  add column if not exists ai_artifact_id   uuid,
  -- Le run IA d'origine (jointure vers `ai_usage`) — évite de dupliquer `generated`.
  add column if not exists ai_run_id        uuid,
  -- Ampleur de la correction humaine, dans [0,1]. Calculée serveur à la validation.
  add column if not exists ai_edit_ratio    real,
  -- Délai génération → décision, en secondes.
  add column if not exists ai_latency_seconds integer,
  -- Clé de déduplication : un même fait (ex. « ce résumé a été affiché ») ne
  -- compte qu'une fois, quels que soient les rerenders. NULL = pas de dédup.
  add column if not exists ai_dedupe_key    text;

-- Vocabulaire FERMÉ, tenu aussi en base : un CHECK est le dernier filet si le
-- contrat TS est un jour contourné. `IS NULL OR IN(...)` laisse passer les
-- lignes d'usage produit (mig 113), qui n'ont pas d'outcome IA.
alter table public.usage_events
  drop constraint if exists usage_events_ai_capability_chk;
alter table public.usage_events
  add constraint usage_events_ai_capability_chk check (
    ai_capability is null or ai_capability in (
      'visit_summary', 'visit_debrief_extract', 'visit_action_proposal'
    )
  );

alter table public.usage_events
  drop constraint if exists usage_events_ai_outcome_chk;
alter table public.usage_events
  add constraint usage_events_ai_outcome_chk check (
    ai_outcome is null or ai_outcome in (
      'generated', 'displayed', 'accepted', 'edited', 'rejected', 'abandoned', 'acted_on'
    )
  );

alter table public.usage_events
  drop constraint if exists usage_events_ai_artifact_type_chk;
alter table public.usage_events
  add constraint usage_events_ai_artifact_type_chk check (
    ai_artifact_type is null or ai_artifact_type in ('visit_report', 'action_proposal')
  );

alter table public.usage_events
  drop constraint if exists usage_events_ai_edit_ratio_chk;
alter table public.usage_events
  add constraint usage_events_ai_edit_ratio_chk check (
    ai_edit_ratio is null or (ai_edit_ratio >= 0 and ai_edit_ratio <= 1)
  );

-- Lecture agrégée par capacité/outcome/jour : l'index couvre l'entonnoir, et ne
-- contient AUCUNE identité — c'est la forme même de la requête admin autorisée.
create index if not exists usage_events_ai_outcome_idx
  on public.usage_events (ai_capability, ai_outcome, created_at desc)
  where ai_capability is not null;

-- Dédup structurelle : un `ai_dedupe_key` non nul est unique. `trackAiOutcome`
-- insère en on-conflict-do-nothing sur cette clé.
create unique index if not exists usage_events_ai_dedupe_uq
  on public.usage_events (ai_dedupe_key)
  where ai_dedupe_key is not null;
