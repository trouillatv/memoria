-- Échéance → sujet + acteur (2026-08-03)
--
-- subject_id       : sujet canonique concerné par cette échéance.
--                    Sélectionné par l'opérateur à la revue, jamais déduit automatiquement.
--
-- assigned_company_id / assigned_contact_id : entreprise / contact responsable de l'échéance.
--   Résolu depuis linkedActorTemporaryKey (pipeline TS post-RPC).
--   NULL si aucun responsable explicite — jamais de fallback automatique.
--
-- Invariant cockpit : seules les échéances status IN ('to_plan', 'planned') alimentent
-- le cockpit opérationnel. Les échéances done/cancelled/superseded restent de la mémoire.

ALTER TABLE public.site_deadlines
  ADD COLUMN IF NOT EXISTS subject_id          uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_contact_id uuid REFERENCES public.company_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_site_deadlines_subject
  ON public.site_deadlines(subject_id)
  WHERE subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_site_deadlines_assigned_company
  ON public.site_deadlines(assigned_company_id)
  WHERE assigned_company_id IS NOT NULL;

COMMENT ON COLUMN public.site_deadlines.subject_id IS
  'Sujet canonique concerné. Choisi par l''opérateur à la revue, non déduit automatiquement.';
COMMENT ON COLUMN public.site_deadlines.assigned_company_id IS
  'Entreprise responsable de l''échéance. Alimenté par pipeline historique (linkedActorTemporaryKey).';
COMMENT ON COLUMN public.site_deadlines.assigned_contact_id IS
  'Contact responsable de l''échéance. Alimenté par pipeline historique (linkedActorTemporaryKey).';
