-- Migration 384 : cache durable de la narration IA d'Évolution (P1-PERF-A)
--
-- Constat P0-PERF : generateEvolutionNarrative (LLM, ~11 s) était appelé en SYNCHRONE
-- à CHAQUE rendu de l'onglet Évolution, y compris quand la matière métier n'avait pas
-- changé. Doctrine : MemorIA calcule → l'IA explique. La narration EXPLIQUE une matière
-- déterministe déjà calculée : même matière → même narration → réutilisation.
--
-- Clé de réutilisation = fingerprint sha256 du couple (version de prompt, system prompt,
-- prompt utilisateur construit depuis le read-model). Le prompt est une fonction PURE du
-- read-model (aucun timestamp de rendu, aucun champ volatil) : deux matières métier
-- identiques produisent le même fingerprint. Toute évolution de la matière (nouveau PV,
-- transition d'état, moments essentiels) change le prompt donc le fingerprint → nouvelle
-- ligne, jamais d'invalidation à la navigation.
--
-- Append-only par (site, fingerprint) : la narration d'une matière passée n'est jamais
-- réécrite. Seules les narrations RÉELLEMENT issues du LLM sont stockées (jamais le
-- fallback déterministe — il se recalcule gratuitement).
--
-- Additif : aucune table existante modifiée.

CREATE TABLE IF NOT EXISTS public.evolution_narrative_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  fingerprint     TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,
  model           TEXT NOT NULL,
  periods         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, fingerprint)
);

COMMENT ON TABLE public.evolution_narrative_cache IS
  'Narrations IA de l''onglet Évolution, réutilisées tant que le fingerprint métier (prompt déterministe) n''a pas changé. Cache de restitution : jamais une source de vérité.';

ALTER TABLE public.evolution_narrative_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON public.evolution_narrative_cache;
CREATE POLICY "service_role_full_access" ON public.evolution_narrative_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);
