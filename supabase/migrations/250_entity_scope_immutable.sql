-- Mémoire sémantique — immuabilité de la portée d'une entité (Vincent, 2026-07-28).
--
-- PROBLÈME IDENTIFIÉ (migration 249) :
--   Le trigger skea_sync_scope_trigger synchronise la portée (organization_id, site_id,
--   user_id) dans les alias à chaque INSERT/UPDATE sur la table d'alias. Mais si la
--   portée d'une entité parente change (UPDATE sur site_knowledge_entities), les alias
--   gardent l'ancienne valeur dénormalisée : l'index unique devient incohérent et la
--   résolution produit des résultats erronés.
--
-- SOLUTION CHOISIE — immuabilité de la portée :
--   Bloquer tout UPDATE qui tenterait de changer organization_id, site_id ou user_id
--   sur une entité existante. Si la portée doit vraiment changer, l'opération correcte
--   est : DELETE puis INSERT (ou copie manuelle des alias vers la nouvelle entité).
--
--   Pourquoi pas une cascade UPDATE ?
--   - La table d'alias peut contenir des milliers de lignes par entité.
--   - Un changement de portée est une opération sémantiquement destructive
--     (une entité "org" et une entité "site" sont deux contextes différents).
--   - L'immuabilité est plus sûre et plus simple à raisonner en production.
--
-- COLONNES PROTÉGÉES DE LA TABLE D'ALIAS :
--   Le trigger skea_sync_scope_trigger (mig 249) écrase systématiquement
--   organization_id, site_id, user_id dans les alias à chaque INSERT OR UPDATE :
--   un client ne peut pas les modifier directement, elles sont toujours dérivées
--   de l'entité parente. Cette migration ne change pas ce comportement.

-- ─── Fonction de garde ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ske_scope_immutable()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  IF (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
    NEW.site_id         IS DISTINCT FROM OLD.site_id         OR
    NEW.user_id         IS DISTINCT FROM OLD.user_id
  ) THEN
    RAISE EXCEPTION
      'site_knowledge_entities: la portée de l''entité % est immuable après création. '
      'Supprimez l''entité et recréez-la avec la portée cible.',
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ske_scope_immutable() IS
  'Empêche la modification de organization_id / site_id / user_id sur une entité existante. '
  'La portée est déterminée à la création et ne peut plus changer (voir mig 249 et mig 250).';

-- ─── Trigger sur la table entités ────────────────────────────────────────────

DROP TRIGGER IF EXISTS ske_scope_immutable_trigger ON public.site_knowledge_entities;
CREATE TRIGGER ske_scope_immutable_trigger
  BEFORE UPDATE ON public.site_knowledge_entities
  FOR EACH ROW EXECUTE FUNCTION public.ske_scope_immutable();
