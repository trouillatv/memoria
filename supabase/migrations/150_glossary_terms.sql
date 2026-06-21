-- Glossaire métier (Vincent 2026-06-21). Stocke le vocabulaire du métier
-- (finisseur, grader, grave-bitume, PAQ, DOE…) avec ses alias, par organisation.
--
-- But V1 : un simple référentiel terme / définition / alias, géré à la main.
-- PAS de LLM, PAS de RAG. Il servira à NOURRIR les futures corrections de
-- transcription (ex. « finisher » → « finisseur ») — exploitation différée.

CREATE TABLE IF NOT EXISTS public.glossary_terms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  term            text NOT NULL,
  definition      text,
  -- Variantes / fautes fréquentes du terme (ce que la transcription écrit à tort).
  aliases         text[] NOT NULL DEFAULT '{}',
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS glossary_terms_org_idx ON public.glossary_terms (organization_id);

COMMENT ON TABLE public.glossary_terms IS
  'Glossaire métier par organisation (mig 150) : terme + définition + alias. Référentiel manuel, nourrira les corrections de transcription (exploitation différée). Pas de LLM/RAG.';

ALTER TABLE public.glossary_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.glossary_terms
  FOR ALL USING (auth.role() = 'service_role');
