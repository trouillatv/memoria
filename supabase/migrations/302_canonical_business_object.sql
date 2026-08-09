-- Migration 302 : canonical_business_object
--
-- Un enregistrement extrait d'un PV = trace documentaire.
-- Plusieurs traces peuvent partager une même identité métier canonique.
-- Les compteurs opérationnels comptent les identités, pas les traces.
--
-- Symétrique avec canonical_subject / subject_thread_identity.

-- ── Table principale ──────────────────────────────────────────────────────────

CREATE TABLE public.canonical_business_object (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  object_type          TEXT NOT NULL
    CHECK (object_type IN ('site_reserve', 'site_action', 'site_deadline')),
  label                TEXT NOT NULL,
  canonical_subject_id UUID REFERENCES public.canonical_subject(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON public.canonical_business_object (site_id, object_type);
CREATE INDEX ON public.canonical_business_object (canonical_subject_id);

-- ── Table de mapping record → identité canonique ──────────────────────────────

CREATE TABLE public.canonical_business_object_member (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_business_object_id UUID NOT NULL
    REFERENCES public.canonical_business_object(id) ON DELETE CASCADE,
  member_entity_type           TEXT NOT NULL
    CHECK (member_entity_type IN ('site_reserve', 'site_action', 'site_deadline')),
  member_entity_id             UUID NOT NULL,
  resolution_source            TEXT NOT NULL DEFAULT 'manual'
    CHECK (resolution_source IN ('manual', 'deterministic', 'llm')),
  llm_confidence               NUMERIC(4,3),
  llm_reasoning                TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un record ne peut appartenir qu'à un seul objet canonique
  UNIQUE (member_entity_type, member_entity_id)
);

-- Index implicitement créé par UNIQUE (member_entity_type, member_entity_id)
CREATE INDEX ON public.canonical_business_object_member (canonical_business_object_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.canonical_business_object        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_business_object_member ENABLE ROW LEVEL SECURITY;

-- Les deux tables héritent de la visibilité site via sites.organization_id
CREATE POLICY "org members can view canonical_business_object"
  ON public.canonical_business_object FOR SELECT
  USING (
    site_id IN (
      SELECT s.id FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "org members can view canonical_business_object_member"
  ON public.canonical_business_object_member FOR SELECT
  USING (
    canonical_business_object_id IN (
      SELECT cbo.id FROM public.canonical_business_object cbo
      JOIN public.sites s ON s.id = cbo.site_id
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

-- Écriture réservée au service_role (résolution via scripts/API interne)
CREATE POLICY "service role manages canonical_business_object"
  ON public.canonical_business_object FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service role manages canonical_business_object_member"
  ON public.canonical_business_object_member FOR ALL
  USING (auth.role() = 'service_role');
