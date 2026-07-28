-- Mémoire sémantique — contrainte d'unicité des alias par portée (Vincent, 2026-07-28).
--
-- Risque identifié après le lot 1A : l'index UNIQUE (entity_id, alias_norm) de la
-- migration 248 empêche de dupliquer un alias sur la même entité, mais pas
-- d'avoir deux entités différentes avec le même alias_norm dans la MÊME portée.
-- Ex. : "electricien" → SNE et "electricien" → Élec Plus, tous deux scope 'org',
-- produisent une résolution déterministe mais silencieuse.
--
-- SOLUTION : dénormaliser (organization_id, site_id, user_id) dans la table d'alias,
-- puis créer un index unique sur (organization_id, site_id, user_id, alias_norm)
-- avec NULLS NOT DISTINCT (Postgres 15+). Ce traitement garantit :
--   - (org1, NULL, NULL, 'electricien') est unique → pas de conflit org-level
--   - (org1, site1, NULL, 'electricien') est unique → pas de conflit site-level
--   - (org1, NULL, NULL, 'electricien') ≠ (org1, site1, NULL, 'electricien') → OK
--     car portées différentes (surcharge intentionnelle chantier > organisation)
--
-- Un trigger BEFORE INSERT/UPDATE maintient la cohérence automatiquement :
-- l'insertion d'un alias ne nécessite pas de spécifier les champs de portée.
--
-- SUPPRESSION (Risk 2 — rappel) :
--   site_knowledge_entities.id → ON DELETE CASCADE sur entity_id dans les alias.
--   Les colonnes organization_id, site_id, user_id ici aussi → ON DELETE CASCADE.
--   Si une org/site/user est supprimé, les alias disparaissent avec l'entité.
--   Comportement explicite : pas de suppression silencieuse, cascade visible.
--
-- CONFLIT DE PRIORITÉ (Risk 3) :
--   Côté DB : bloqué par l'index unique ci-dessous.
--   Côté app : detectAliasConflicts() dans lib/knowledge/semantic-entities.ts
--   remonte les conflits pour logging et alerte future sans casser le pipeline.

-- ─── Dénormalisation de la portée ────────────────────────────────────────────

ALTER TABLE public.site_knowledge_entity_aliases
  ADD COLUMN IF NOT EXISTS organization_id uuid
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS site_id uuid
    REFERENCES public.sites(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id uuid
    REFERENCES public.users(id) ON DELETE CASCADE;

-- Remplissage depuis l'entité parent.
-- Tables vides à ce stade (migration 248 vient d'être créée, jamais alimentée en prod).
UPDATE public.site_knowledge_entity_aliases a
SET
  organization_id = e.organization_id,
  site_id         = e.site_id,
  user_id         = e.user_id
FROM public.site_knowledge_entities e
WHERE a.entity_id = e.id;

-- organization_id ne peut pas être null (toute entité appartient à une org)
ALTER TABLE public.site_knowledge_entity_aliases
  ALTER COLUMN organization_id SET NOT NULL;

COMMENT ON COLUMN public.site_knowledge_entity_aliases.organization_id IS
  'Dénormalisé depuis site_knowledge_entities. Maintenu par le trigger skea_sync_scope_trigger.';
COMMENT ON COLUMN public.site_knowledge_entity_aliases.site_id IS
  'Dénormalisé depuis site_knowledge_entities. NULL = portée organisation.';
COMMENT ON COLUMN public.site_knowledge_entity_aliases.user_id IS
  'Dénormalisé depuis site_knowledge_entities. NULL = portée partagée.';

-- ─── Contrainte d'unicité par portée ─────────────────────────────────────────
-- NULLS NOT DISTINCT (Postgres 15+) : traite NULL = NULL dans l'unicité.
-- → Deux alias_norm identiques dans la même portée (même org + même site + même user)
--   sont rejetés même si site_id ou user_id est NULL.
-- → Une surcharge inter-portées reste autorisée (scope chantier ≠ scope org).

CREATE UNIQUE INDEX IF NOT EXISTS skea_scope_alias_norm_uniq
  ON public.site_knowledge_entity_aliases (organization_id, site_id, user_id, alias_norm)
  NULLS NOT DISTINCT;

-- ─── Trigger de synchronisation ──────────────────────────────────────────────
-- Remplit automatiquement organization_id / site_id / user_id à l'insertion
-- depuis l'entité parent. L'appelant n'a pas à les spécifier.

CREATE OR REPLACE FUNCTION public.skea_sync_scope()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  SELECT e.organization_id, e.site_id, e.user_id
  INTO NEW.organization_id, NEW.site_id, NEW.user_id
  FROM public.site_knowledge_entities e
  WHERE e.id = NEW.entity_id;

  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'site_knowledge_entity_aliases: entity_id % introuvable', NEW.entity_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.skea_sync_scope() IS
  'Maintient la cohérence des colonnes de portée (organization_id, site_id, user_id) dans site_knowledge_entity_aliases en les synchronisant avec l''entité parent.';

DROP TRIGGER IF EXISTS skea_sync_scope_trigger ON public.site_knowledge_entity_aliases;
CREATE TRIGGER skea_sync_scope_trigger
  BEFORE INSERT OR UPDATE ON public.site_knowledge_entity_aliases
  FOR EACH ROW EXECUTE FUNCTION public.skea_sync_scope();
