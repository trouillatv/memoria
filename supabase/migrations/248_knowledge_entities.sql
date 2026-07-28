-- Mémoire sémantique des chantiers — Lot 1A (Vincent, 2026-07-28).
--
-- DOCTRINE : MemorIA apprend progressivement le vocabulaire de l'entreprise.
-- Chaque entité canonique (personne, entreprise, acronyme, expression) est résolue
-- AVANT l'envoi au LLM : le modèle raisonne avec les bons noms dès le départ.
--
-- Deux tables :
--   site_knowledge_entities        : l'entité (ce qu'elle EST réellement)
--   site_knowledge_entity_aliases  : ses appellations reconnues (ce que l'utilisateur DIT)
--
-- Portée de résolution (priorité décroissante) :
--   1. user_id non-null  → règle personnelle (utilisateur spécifique)
--   2. site_id non-null, user_id null → règle chantier
--   3. site_id null, user_id null    → règle organisation
--
-- Provenance : source = 'manual' | 'imported' | 'ai_suggested'
--   L'apprentissage automatique est prévu en Lot 2. Ce lot pose les fondations.
--
-- RLS : portée organisation via current_user_org_id(). Le pipeline IA utilise
--   l'admin client (bypass RLS) ; les politiques protègent l'accès direct.

-- ─── Entités canoniques ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_knowledge_entities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NULL = portée organisation · non-null = portée chantier
  site_id         uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  -- NULL = partagé · non-null = règle personnelle (priorité maximale)
  user_id         uuid REFERENCES public.users(id) ON DELETE CASCADE,

  canonical_label text NOT NULL,
  entity_type     text NOT NULL
    CHECK (entity_type IN ('company', 'person', 'acronym', 'expression', 'pronunciation')),

  confidence      float NOT NULL DEFAULT 1.0
    CHECK (confidence >= 0.0 AND confidence <= 1.0),
  is_active       boolean NOT NULL DEFAULT true,

  -- Provenance : comment cette entité a été créée
  source          text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'imported', 'ai_suggested')),

  -- Métadonnées structurées selon entity_type :
  --   company     : { trade, phone }
  --   person      : { first_name, last_name, company_id, role }
  --   autres      : {}
  metadata        jsonb NOT NULL DEFAULT '{}',

  validated_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  validated_at    timestamptz,
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.site_knowledge_entities IS
  'Entités canoniques de la mémoire sémantique. Une entité = ce qu''elle est réellement. Ses alias = ce que l''utilisateur dit.';
COMMENT ON COLUMN public.site_knowledge_entities.site_id IS
  'NULL = portée organisation. Non-null = portée chantier (priorité sur organisation).';
COMMENT ON COLUMN public.site_knowledge_entities.user_id IS
  'NULL = partagé. Non-null = règle personnelle de cet utilisateur (priorité maximale).';
COMMENT ON COLUMN public.site_knowledge_entities.source IS
  'Provenance : manual (saisie admin), imported (équipe chantier), ai_suggested (Lot 2 — non implémenté).';

CREATE INDEX IF NOT EXISTS ske_org_site_active_idx
  ON public.site_knowledge_entities (organization_id, site_id, is_active);
CREATE INDEX IF NOT EXISTS ske_org_user_active_idx
  ON public.site_knowledge_entities (organization_id, user_id, is_active)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.site_knowledge_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ske org read" ON public.site_knowledge_entities;
CREATE POLICY "ske org read" ON public.site_knowledge_entities
  FOR SELECT USING (
    organization_id = public.current_user_org_id()
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "ske org write" ON public.site_knowledge_entities;
CREATE POLICY "ske org write" ON public.site_knowledge_entities
  FOR ALL USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role() IN ('admin', 'manager')
  )
  WITH CHECK (
    organization_id = public.current_user_org_id()
    AND public.current_user_role() IN ('admin', 'manager')
  );

-- ─── Alias (une ligne par appellation reconnue) ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_knowledge_entity_aliases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL
    REFERENCES public.site_knowledge_entities(id) ON DELETE CASCADE,
  -- Forme brute telle que dite / écrite par l'utilisateur
  alias       text NOT NULL,
  -- Forme normalisée pour la correspondance déterministe.
  -- Même algorithme que normalize() dans lib/db/knowledge-proposals.ts :
  -- minuscules · NFD · sans diacritiques · sans ponctuation · trim.
  alias_norm  text NOT NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entity_id, alias_norm)
);

COMMENT ON TABLE public.site_knowledge_entity_aliases IS
  'Appellations reconnues pour une entité (une ligne par forme). Ex. : "les électriciens", "l''élec" → Élec Plus.';
COMMENT ON COLUMN public.site_knowledge_entity_aliases.alias_norm IS
  'Normalisé identiquement à normalize() de knowledge-proposals.ts. Garantit la correspondance déterministe et la compatibilité avec la validation post-LLM (Lot 1B).';

CREATE INDEX IF NOT EXISTS skea_entity_idx
  ON public.site_knowledge_entity_aliases (entity_id);
CREATE INDEX IF NOT EXISTS skea_norm_idx
  ON public.site_knowledge_entity_aliases (alias_norm);

ALTER TABLE public.site_knowledge_entity_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "skea org read" ON public.site_knowledge_entity_aliases;
CREATE POLICY "skea org read" ON public.site_knowledge_entity_aliases
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.site_knowledge_entities e
      WHERE e.id = entity_id
        AND e.organization_id = public.current_user_org_id()
        AND auth.role() = 'authenticated'
    )
  );

DROP POLICY IF EXISTS "skea org write" ON public.site_knowledge_entity_aliases;
CREATE POLICY "skea org write" ON public.site_knowledge_entity_aliases
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.site_knowledge_entities e
      WHERE e.id = entity_id
        AND e.organization_id = public.current_user_org_id()
        AND public.current_user_role() IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.site_knowledge_entities e
      WHERE e.id = entity_id
        AND e.organization_id = public.current_user_org_id()
        AND public.current_user_role() IN ('admin', 'manager')
    )
  );
