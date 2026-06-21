-- =============================================================================
-- 140 — Enrichissement de la capture passive (Vincent 2026-06-21, note 9.5/10).
-- On collecte plus de contexte MAINTENANT (irréversible) ; toujours zéro IA.
--
--   cr_number        : rang du CR dans le site → « les corrections sont-elles plus
--                      nombreuses sur les premiers ou les derniers CR ? »
--   source_type      : origine de l'objet corrigé — 'ai' (l'IA l'avait proposé, ex.
--                      ligne exclue / trou détecté) vs 'human' (ajout humain) vs
--                      'unknown'. Distinguer « corriger une proposition IA » de
--                      « édition humaine ».
--   ai_confidence    : confiance initiale de l'IA si connue (95% → corrigé = mine d'or).
--                      Prête mais souvent NULL tant que l'analyse n'émet pas de score
--                      par champ.
--   time_to_correct_ms : temps passé sur la correction (timing client) → « ce qui fait
--                      perdre du temps » (organisme 4 s vs décision 2 min).
-- =============================================================================

alter table public.memory_correction_events
  add column if not exists cr_number          integer,
  add column if not exists source_type        text check (source_type in ('ai', 'human', 'mixed', 'unknown')),
  add column if not exists ai_confidence       numeric,
  add column if not exists time_to_correct_ms  integer;
