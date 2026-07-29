-- 254 — Criticité et contexte sur la liste « À vérifier » (mig 196).
--
-- priority (critical | important | normal) : dérivée de façon déterministe depuis
-- le type de signal au moment du seed. Jamais calculée a posteriori — la
-- photographie du briefing reste immuable même si la situation change.
--   critical  → preuve irréversible imminente, obligation réglementaire
--   important → réserve ouverte, action en retard, décision non appliquée
--   normal    → suivi courant, suggestion de contrôle sans retard identifié
--
-- reason : le « pourquoi » du point — item.meta du signal (ex : « ouvert depuis
-- 72 j », « avant dépose plafond »). Null si le signal n'en produit pas.
--
-- Rollback : ALTER TABLE DROP COLUMN (sans cascade).

ALTER TABLE public.visit_watchlist_item
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'
    CONSTRAINT visit_watchlist_item_priority_check
      CHECK (priority IN ('critical', 'important', 'normal'));

ALTER TABLE public.visit_watchlist_item
  ADD COLUMN IF NOT EXISTS reason text;

COMMENT ON COLUMN public.visit_watchlist_item.priority IS
  'Criticité déterministe : critical (irréversible/réglementaire) · important · normal.';
COMMENT ON COLUMN public.visit_watchlist_item.reason IS
  'Contexte court du signal source — item.meta (ex : « ouvert depuis 72 j »).';
