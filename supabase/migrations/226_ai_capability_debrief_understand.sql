-- Migration 226 — Étendre le vocabulaire fermé des capacités IA mesurables.
--
-- Lot 5.1A-2 : on mesure `displayed` sur la NARRATION que le conducteur lit à
-- l'écran. Découverte par lecture du code (jamais supposée) : cette narration
-- n'est PAS produite par `visit_summary` (un repli PDF/markdown, presque jamais
-- affiché) mais par `visit_debrief_understand` — commenté `// montré à l'UI`
-- dans services/ai/visit-debrief.ts, et rendu dans le bloc « Résumé » du CR
-- mobile. Mesurer `visit_summary` à la lettre aurait donné un signal ~0 qui ne
-- reflète pas la réalité : décision produit de Vincent (2026-07-21) de viser la
-- capacité réellement lue.
--
-- Additive : on n'ajoute qu'UNE valeur au CHECK, aucune ligne existante n'est
-- touchée (le CHECK n'a jamais rejeté ce qu'il connaît déjà). Idempotente.
-- Rollback : recréer le CHECK de la mig 224 (sans `visit_debrief_understand`).

alter table public.usage_events
  drop constraint if exists usage_events_ai_capability_chk;

alter table public.usage_events
  add constraint usage_events_ai_capability_chk check (
    ai_capability is null or ai_capability in (
      'visit_summary', 'visit_debrief_extract', 'visit_action_proposal',
      'visit_debrief_understand'
    )
  );
