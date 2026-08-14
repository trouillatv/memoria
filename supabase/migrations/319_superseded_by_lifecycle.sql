-- 319 — LA CAPACITÉ DE REMPLACEMENT (P0-2ter, arbitrage Vincent 2026-08-14).
--
-- Doctrine « cycle de vie de l'information » : Obsolète/remplacé ≠ Écarté.
-- « Le cadenas n'est pas installé » (10 août) n'est pas une erreur quand le
-- cadenas est installé le 17 — c'est de l'HISTOIRE. La mémoire doit pouvoir
-- conserver : ancienne situation → remplacée par → nouvelle situation, au lieu
-- de faire disparaître l'ancienne vérité.
--
-- Le modèle de référence est site_deadlines (migs 215+246) : superseded_by y
-- existe déjà. On GÉNÉRALISE ce chaînage aux objets pour lesquels « A est
-- remplacé par B » a un sens : actions, décisions, vigilances.
--
-- VOLONTAIREMENT ABSENT : site_intervenants. Pour un intervenant, la
-- temporalité (effective_from/effective_to) EST la vérité principale — Jean
-- parti n'est pas une information obsolète, son intervention était vraie
-- historiquement. Un éventuel « Paul remplace Jean dans ce rôle » sera traité
-- séparément s'il devient un besoin réel (décision Vincent).
--
-- PUREMENT ADDITIF : colonnes nullable, aucune contrainte existante modifiée,
-- aucun statut renommé. L'état terminal reste porté par la colonne de statut
-- existante (cancelled / caduque / contredite / resolved…) ; superseded_by
-- explique PAR QUOI l'objet a été remplacé. NB : site_decisions porte déjà des
-- états d'obsolescence (caduque, contredite) — il ne lui manquait que le
-- chaînage vers la décision qui remplace.

alter table public.site_actions
  add column if not exists superseded_by uuid references public.site_actions(id) on delete set null,
  add column if not exists superseded_at timestamptz;

comment on column public.site_actions.superseded_by is
  'Action qui remplace celle-ci (chaînage avant→après, doctrine 2026-08-14). NULL = jamais remplacée.';

alter table public.site_decisions
  add column if not exists superseded_by uuid references public.site_decisions(id) on delete set null,
  add column if not exists superseded_at timestamptz;

comment on column public.site_decisions.superseded_by is
  'Décision qui remplace celle-ci (à combiner avec statut caduque/contredite). NULL = jamais remplacée.';

alter table public.site_watchpoints
  add column if not exists superseded_by uuid references public.site_watchpoints(id) on delete set null,
  add column if not exists superseded_at timestamptz;

comment on column public.site_watchpoints.superseded_by is
  'Vigilance qui remplace celle-ci. NULL = jamais remplacée.';

-- Lecture lifeline : « qu'est-ce qui a remplacé X ? » et « X remplace quoi ? »
create index if not exists site_actions_superseded_by_idx on public.site_actions (superseded_by) where superseded_by is not null;
create index if not exists site_decisions_superseded_by_idx on public.site_decisions (superseded_by) where superseded_by is not null;
create index if not exists site_watchpoints_superseded_by_idx on public.site_watchpoints (superseded_by) where superseded_by is not null;
