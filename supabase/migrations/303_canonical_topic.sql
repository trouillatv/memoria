-- Migration 303 : canonical_topic
--
-- Niveau de lecture au-dessus des canonical_subject.
-- Un topic regroupe plusieurs canonical_subject partageant une réalité physique commune.
-- Coexiste avec thematic_category (issu de l'extraction) — pas de remplacement en V1.
-- Créé par résolution LLM (batch Gemini) ou manuellement après.

-- ── Table principale ──────────────────────────────────────────────────────────

CREATE TABLE public.canonical_topic (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  resolution_source TEXT NOT NULL DEFAULT 'llm'
    CHECK (resolution_source IN ('manual', 'llm')),
  llm_confidence    NUMERIC(4,3),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON public.canonical_topic (site_id);

-- ── Table de membership ───────────────────────────────────────────────────────

CREATE TABLE public.canonical_topic_subject (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_topic_id   UUID NOT NULL
    REFERENCES public.canonical_topic(id) ON DELETE CASCADE,
  canonical_subject_id UUID NOT NULL
    REFERENCES public.canonical_subject(id) ON DELETE CASCADE,
  resolution_source    TEXT NOT NULL DEFAULT 'llm'
    CHECK (resolution_source IN ('manual', 'llm')),
  llm_confidence       NUMERIC(4,3),
  llm_reasoning        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un canonical_subject ne peut appartenir qu'à un seul topic
  UNIQUE (canonical_subject_id)
);

CREATE INDEX ON public.canonical_topic_subject (canonical_topic_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.canonical_topic         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_topic_subject ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view canonical_topic"
  ON public.canonical_topic FOR SELECT
  USING (
    site_id IN (
      SELECT s.id FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "org members can view canonical_topic_subject"
  ON public.canonical_topic_subject FOR SELECT
  USING (
    canonical_topic_id IN (
      SELECT ct.id FROM public.canonical_topic ct
      JOIN public.sites s ON s.id = ct.site_id
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "service role manages canonical_topic"
  ON public.canonical_topic FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service role manages canonical_topic_subject"
  ON public.canonical_topic_subject FOR ALL
  USING (auth.role() = 'service_role');
