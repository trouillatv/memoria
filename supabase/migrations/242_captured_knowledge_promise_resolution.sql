-- 242 — Résolution d'une promesse : parité d'audit de captured_knowledge avec
-- site_knowledge_proposals (Cockpit — résolution persistante des promesses, T1).
--
-- Une promesse vit dans DEUX tables sources (cf. lib/db/promise-candidates.ts) :
--   · site_knowledge_proposals : porte déjà tout l'audit de résolution
--     (reviewed_by, dismiss_reason, superseded_by) ;
--   · captured_knowledge : ne portait que `resolution` + `resolved_at` (mig 178),
--     sans AUTEUR de la décision ni lien de remplacement.
--
-- On aligne captured_knowledge, de façon PUREMENT ADDITIVE (colonnes nullables,
-- sans DEFAULT, idempotent) : aucune ligne existante n'est touchée, aucun code
-- actuel ne dépend de ces colonnes. Les issues métier se poseront sur le `status`
-- terminal existant (resolved | obsolete | dismissed), enrichi de l'audit :
--   · réalisée  → status='resolved'   + resolved_by + resolved_at (+ resolution)
--   · annulée   → status='dismissed'  + resolved_by + resolved_at + dismiss_reason
--   · remplacée → status='obsolete'   + resolved_by + resolved_at + replaced_by
--                 (la remplaçante est une nouvelle ligne captured_knowledge,
--                  créée et liée dans la même transaction — travail de T3).
--
-- NB (hors périmètre de cette migration, à traiter au chemin d'écriture, T3) :
-- aujourd'hui `resolved_at` n'est posé que sur la transition 'resolved'
-- (resolveCapturedKnowledgeWithAnswer). Les nouvelles mutations devront le poser —
-- ainsi que `resolved_by` — sur TOUTES les transitions terminales. Ce fichier ne
-- fait qu'ouvrir les colonnes ; il ne réécrit aucune donnée.

alter table public.captured_knowledge
  -- Auteur de la décision de résolution (fail-open : on ne perd pas la ligne si
  -- l'utilisateur est supprimé). Miroir de `reviewed_by` côté proposals.
  add column if not exists resolved_by uuid references public.users(id) on delete set null,
  -- Motif d'une promesse ANNULÉE (« l'engagement n'est plus attendu »). Distinct
  -- de `resolution` (le contenu d'une réponse trouvée). Miroir de `dismiss_reason`.
  add column if not exists dismiss_reason text,
  -- Lien vers la promesse REMPLAÇANTE (nouvelle ligne captured_knowledge). SET NULL
  -- si la remplaçante disparaît : l'ancienne reste terminale, le lien s'efface.
  -- Miroir de `superseded_by` côté proposals.
  add column if not exists replaced_by uuid references public.captured_knowledge(id) on delete set null;

-- Traçabilité inverse « qu'est-ce que cette promesse a remplacé ? » sans balayage.
create index if not exists captured_knowledge_replaced_by_idx
  on public.captured_knowledge (replaced_by) where replaced_by is not null;

comment on column public.captured_knowledge.resolved_by is
  'Auteur de la résolution (résolue/annulée/remplacée) — parité d''audit avec site_knowledge_proposals.reviewed_by (mig 242).';
comment on column public.captured_knowledge.dismiss_reason is
  'Motif d''annulation d''une promesse (« plus attendue ») — distinct de resolution (mig 242).';
comment on column public.captured_knowledge.replaced_by is
  'Promesse remplaçante (self-FK) quand status devient obsolete par remplacement — miroir de superseded_by (mig 242).';
