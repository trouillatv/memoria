-- 346 — Lien terrain : canonical_subject_id sur site_actions et site_deadlines
--
-- Contexte P1-3C.1 : les objets métier créés depuis le copilote ou le terrain
-- (sans PV historique source) n'ont ni subject_thread_id ni lien vers un
-- canonical_subject. Cette colonne permet d'enregistrer ce lien au moment de
-- la création, via resolveCanonicalSubjectReference (Jaccard déterministe, sans LLM).
--
-- Chemin de lecture : canonical-subject-life.ts §2B-ter lit ces colonnes pour
-- inclure les objets terrain dans activeObjects, indépendamment du chemin PV
-- (document_proposal_materialization → subject_thread_id).
--
-- Invariants :
--   - nullable : null = lien non encore résolu ou sujet non trouvé
--   - jamais écrit en backfill automatique sans validation humaine (P1-3C.1 doctrine)
--   - la colonne subject_thread_id (mig 288) reste le lien canonique pour les
--     objets issus des PV historiques — les deux colonnes sont complémentaires

ALTER TABLE public.site_actions
  ADD COLUMN IF NOT EXISTS canonical_subject_id UUID REFERENCES canonical_subject(id);

CREATE INDEX IF NOT EXISTS sa_canonical_site_idx
  ON public.site_actions (site_id, canonical_subject_id)
  WHERE canonical_subject_id IS NOT NULL;

ALTER TABLE public.site_deadlines
  ADD COLUMN IF NOT EXISTS canonical_subject_id UUID REFERENCES canonical_subject(id);

CREATE INDEX IF NOT EXISTS sdl_canonical_site_idx
  ON public.site_deadlines (site_id, canonical_subject_id)
  WHERE canonical_subject_id IS NOT NULL;
