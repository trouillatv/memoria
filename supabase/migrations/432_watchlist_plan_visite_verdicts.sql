-- 432 — Plan de visite (Lot B) : deux nouveaux états de verdict watchlist.
--
-- Additif uniquement — aucune donnée existante n'est convertie :
--   not_applicable_visit    : sans objet POUR CETTE VISITE (peut réapparaître à N+1).
--   dismissed_permanently   : ne plus suivre DÉFINITIVEMENT (ne réapparaît jamais).
--
-- Le legacy `not_applicable` (mig 255) reste inchangé et n'est plus produit par
-- la nouvelle UI, mais sa mémoire (lib/visits/watchlist-not-applicable-memory.ts)
-- continue de s'appliquer exclusivement aux verdicts déjà rendus sous cet état.
--
-- Rollback :
--   ALTER TABLE visit_watchlist_item DROP CONSTRAINT visit_watchlist_item_state_check;
--   ALTER TABLE visit_watchlist_item
--     ADD CONSTRAINT visit_watchlist_item_state_check
--       CHECK (state IN ('pending', 'checked', 'still_open', 'not_applicable'));
--   (aucune donnée à reconvertir : cette migration n'en écrit aucune)

ALTER TABLE public.visit_watchlist_item
  DROP CONSTRAINT IF EXISTS visit_watchlist_item_state_check;

ALTER TABLE public.visit_watchlist_item
  ADD CONSTRAINT visit_watchlist_item_state_check
    CHECK (state IN (
      'pending',
      'checked',
      'still_open',
      'not_applicable',
      'not_applicable_visit',
      'dismissed_permanently'
    ));
