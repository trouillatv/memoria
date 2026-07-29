-- 255 — États de la liste « À vérifier » : renommage sémantique + table d'evidence.
--
-- RENOMMAGE (rupture contrôlée, données migrées avant repose de la contrainte) :
--   verified  → checked       (conforme — on a vérifié)
--   to_follow → still_open    (toujours ouvert — problème persistant)
--   dismissed → not_applicable (sans objet — ne s'applique pas à cette visite)
-- pending reste inchangé.
--
-- TABLE visit_capture_watchlist_item : liaison M-M capture ↔ point de contrôle.
-- Une photo peut prouver plusieurs points ; un point peut avoir plusieurs photos.
-- La FK capture_id existante sur visit_watchlist_item reste pour la liaison 1-1
-- rapide au terrain (pas de suppression — les deux coexistent).
--
-- Rollback :
--   DROP TABLE visit_capture_watchlist_item;
--   ALTER TABLE visit_watchlist_item DROP CONSTRAINT visit_watchlist_item_state_check2;
--   UPDATE ... (inverser les renames)
--   ADD CONSTRAINT visit_watchlist_item_state_check CHECK (state IN (...));

-- 1. Lever la contrainte actuelle pour permettre la migration des données.
ALTER TABLE public.visit_watchlist_item
  DROP CONSTRAINT IF EXISTS visit_watchlist_item_state_check;

-- 2. Migrer les valeurs existantes.
UPDATE public.visit_watchlist_item SET state = 'checked'         WHERE state = 'verified';
UPDATE public.visit_watchlist_item SET state = 'still_open'      WHERE state = 'to_follow';
UPDATE public.visit_watchlist_item SET state = 'not_applicable'  WHERE state = 'dismissed';

-- 3. Reposer la contrainte avec les nouvelles valeurs.
ALTER TABLE public.visit_watchlist_item
  ADD CONSTRAINT visit_watchlist_item_state_check
    CHECK (state IN ('pending', 'checked', 'still_open', 'not_applicable'));

-- 4. Table de liaison M-M capture ↔ point de contrôle.
CREATE TABLE IF NOT EXISTS public.visit_capture_watchlist_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES public.visit_watchlist_item(id) ON DELETE CASCADE,
  capture_id  uuid NOT NULL REFERENCES public.visit_capture(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, capture_id)
);

CREATE INDEX IF NOT EXISTS vcwi_item_idx    ON public.visit_capture_watchlist_item (item_id);
CREATE INDEX IF NOT EXISTS vcwi_capture_idx ON public.visit_capture_watchlist_item (capture_id);

COMMENT ON TABLE public.visit_capture_watchlist_item IS
  'Liaison M-M : une capture peut prouver plusieurs points de contrôle, un point peut avoir plusieurs preuves (mig 255).';
