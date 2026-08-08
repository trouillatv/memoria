-- Migration 301 — Étape 2 : relier canonical_subject_suggestion aux propositions terrain
--
-- Contexte :
--   Les propositions terrain ambiguës (canonical_resolution_status = 'needs_resolution')
--   n'avaient aucune surface de validation humaine. Ce lot les fait remonter dans la
--   file globale "Sujets à rapprocher" en créant une suggestion via LLM quand le
--   résolveur déterministe trouve 2–3 candidats.
--
-- Changements :
--   1. subject_thread_id devient nullable — route PV conserve le comportement existant,
--      route visite terrain utilise source_proposal_id à la place.
--   2. source_proposal_id FK nullable vers site_knowledge_proposals.
--   3. CHECK XOR : exactement l'un des deux doit être non-null.
--   4. Index unique partiel pour la route visite (dédup par proposition + version).
--
-- Invariants préservés :
--   - La contrainte css_unique_thread_version reste intacte : PostgreSQL traite les NULLs
--     comme distincts dans UNIQUE, donc les lignes visite (subject_thread_id IS NULL)
--     ne créent aucun conflit avec les lignes PV existantes.
--   - L'upsert de resolveOrphansSemantically (onConflict: 'subject_thread_id,resolver_version')
--     continue de fonctionner sans modification : il ne produit que des lignes PV.
--   - Les RPC accept_subject_suggestion et undo_accept_subject_suggestion ne sont pas
--     touchés — ils opèrent exclusivement sur subject_thread_identity.

-- ── 1. Rendre subject_thread_id nullable ────────────────────────────────────────

ALTER TABLE public.canonical_subject_suggestion
  ALTER COLUMN subject_thread_id DROP NOT NULL;

-- ── 2. Ajouter source_proposal_id ───────────────────────────────────────────────

ALTER TABLE public.canonical_subject_suggestion
  ADD COLUMN source_proposal_id UUID
    REFERENCES public.site_knowledge_proposals(id) ON DELETE CASCADE;

-- ── 3. CHECK d'origine exclusif (XOR) ───────────────────────────────────────────

ALTER TABLE public.canonical_subject_suggestion
  ADD CONSTRAINT chk_css_origin CHECK (
    (subject_thread_id IS NOT NULL AND source_proposal_id IS NULL)
    OR
    (subject_thread_id IS NULL    AND source_proposal_id IS NOT NULL)
  );

-- ── 4. Dédup pour la route visite terrain ───────────────────────────────────────

CREATE INDEX idx_css_source_proposal
  ON public.canonical_subject_suggestion(source_proposal_id)
  WHERE source_proposal_id IS NOT NULL;

CREATE UNIQUE INDEX uq_css_proposal_version
  ON public.canonical_subject_suggestion(source_proposal_id, resolver_version)
  WHERE source_proposal_id IS NOT NULL;
