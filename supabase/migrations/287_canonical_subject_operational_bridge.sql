-- Migration 287 — Pont entre canonical_subject (mémoire historique) et subjects (sujet opérationnel)
--
-- Doctrine :
--   canonical_subject = identité durable dans les documents ("De quoi parlent les PV ?")
--   subjects          = sujet opérationnel piloté dans l'application (actions, cockpit, échéances)
--
-- Ces deux tables sont indépendantes et doivent le rester.
-- Un canonical_subject peut exister sans subject opérationnel (ex. événements ponctuels,
-- intempéries, faits terminés, sujets purement informatifs).
--
-- Le pont est nullable et à cardinalité 0..1 → 0..1 :
--   - N canonical_subjects peuvent pointer vers le même subject opérationnel (faux éclatements fusionnés).
--   - 1 canonical_subject pointe vers au plus 1 subject opérationnel.
--
-- Cas d'usage futur : "Promouvoir en sujet suivi"
--   L'opérateur décide explicitement de transformer un sujet historique en sujet opérationnel.
--   Le lien est créé manuellement. Jamais automatiquement.

ALTER TABLE public.canonical_subject
  ADD COLUMN IF NOT EXISTS operational_subject_id uuid
    REFERENCES public.subjects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_subject_operational
  ON public.canonical_subject(operational_subject_id)
  WHERE operational_subject_id IS NOT NULL;

COMMENT ON COLUMN public.canonical_subject.operational_subject_id IS
  'Pont explicite vers le sujet opérationnel (subjects.id) si ce canonical subject a été promu. NULL = mémoire historique uniquement.';
