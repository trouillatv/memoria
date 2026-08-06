-- Migration 299 — Pont d'identité acteur sur canonical_subject
--
-- Pour les canonical_subject de kind=person|company, permet de pointer
-- durablement vers l'identité réelle correspondante :
--   kind=person → contact_id → company_contacts
--   kind=company → company_id → companies
--
-- L'identité reste company_contacts / companies.
-- canonical_subject représente la présence de cet acteur dans la mémoire
-- d'un chantier, pas une nouvelle identité autonome.
--
-- Colonnes d'audit (source / confidence / validated_*) répliquent le pattern
-- établi sur subject_thread_identity (mig 279) et canonical_subject_suggestion
-- (mig 280). Permettent de distinguer : liaison automatique (exact match org),
-- suggestion LLM (future), validation humaine.
--
-- Index UNIQUE partiels sur status='active' : empêchent qu'un même acteur ait
-- deux canonical_subjects actifs sur le même chantier. Les anciens sujets
-- merged coexistent sans contrainte.

ALTER TABLE public.canonical_subject
  ADD COLUMN IF NOT EXISTS contact_id uuid
    REFERENCES public.company_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_id uuid
    REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_link_source text
    CHECK (actor_link_source IN ('auto', 'llm', 'manual')),
  ADD COLUMN IF NOT EXISTS actor_link_confidence numeric(4,3)
    CHECK (actor_link_confidence >= 0 AND actor_link_confidence <= 1),
  ADD COLUMN IF NOT EXISTS actor_link_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS actor_link_validated_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT canonical_subject_actor_exclusion
    CHECK (contact_id IS NULL OR company_id IS NULL);

COMMENT ON COLUMN public.canonical_subject.contact_id IS
  'Identité réelle de l''acteur (personne). Uniquement pour kind=person. Mutuellement exclusif avec company_id.';

COMMENT ON COLUMN public.canonical_subject.company_id IS
  'Identité réelle de l''acteur (entreprise). Uniquement pour kind=company. Mutuellement exclusif avec contact_id.';

COMMENT ON COLUMN public.canonical_subject.actor_link_source IS
  'Comment le lien a été établi : auto (exact match org), llm (suggestion modèle), manual (validation humaine).';

COMMENT ON COLUMN public.canonical_subject.actor_link_confidence IS
  'Score de confiance du lien (0.000–1.000). NULL si source=auto ou manual.';

COMMENT ON COLUMN public.canonical_subject.actor_link_validated_at IS
  'Quand un humain a confirmé ou créé ce lien.';

COMMENT ON COLUMN public.canonical_subject.actor_link_validated_by IS
  'Qui a confirmé ce lien (référence auth.users).';

-- Un même acteur ne peut avoir qu'un seul canonical_subject actif par chantier.
-- Les sujets merged ou archivés ne sont pas contraints (status != 'active').
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_subject_active_contact
  ON public.canonical_subject(site_id, contact_id)
  WHERE contact_id IS NOT NULL
    AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_subject_active_company
  ON public.canonical_subject(site_id, company_id)
  WHERE company_id IS NOT NULL
    AND status = 'active';

-- Index de navigation : retrouver tous les sujets acteur d'un contact ou d'une
-- entreprise (cross-site : M. Ganter sur chantier A et B = deux sujets distincts).
CREATE INDEX IF NOT EXISTS idx_canonical_subject_contact
  ON public.canonical_subject(contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_subject_company
  ON public.canonical_subject(company_id)
  WHERE company_id IS NOT NULL;
