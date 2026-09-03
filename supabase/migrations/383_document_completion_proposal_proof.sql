-- Migration 383 : preuve documentaire à l'unité ATOMIQUE (P1-4B-PROPOSAL PHASE 2)
--
-- L'audit proof-identity a établi que canonical_subject_occurrence est un AGRÉGAT longitudinal
-- (sujet, PV, state_key) qui conflète plusieurs faits documentaires — donc pas l'unité de preuve.
-- L'unité de preuve correcte est document_extraction_proposal (un fait cohérent unique).
--
-- Modèle à DEUX références, exactement une renseignée (XOR) :
--   - proof_occurrence_id  → résolutions LEGACY occurrence-level (V2/V2.1/V2.2), IMMUABLES ;
--   - proof_proposal_id    → nouvelle vérité atomique proposition-level.
--
-- FK proposition SANS ON DELETE CASCADE : une résolution est un artefact d'AUDIT ; une ré-extraction
-- ne doit jamais faire disparaître silencieusement la preuve d'une décision passée (NO ACTION).
--
-- Idempotence : NULLS DISTINCT (défaut PG) ferait que deux lignes proposal-level (occurrence NULL)
-- ne collisionnent pas → on remplace l'UNIQUE global par DEUX index PARTIELS ancrés sur la colonne
-- non-null. Le partiel occurrence est identique pour les lignes existantes (toutes non-null).
--
-- Additif : aucune ligne existante modifiée.

-- 1. Références de preuve : occurrence nullable + proposition nullable + XOR
ALTER TABLE public.document_completion_resolution ALTER COLUMN proof_occurrence_id DROP NOT NULL;
ALTER TABLE public.document_completion_resolution
  ADD COLUMN IF NOT EXISTS proof_proposal_id UUID REFERENCES public.document_extraction_proposal(id);
ALTER TABLE public.document_completion_resolution
  ADD CONSTRAINT dcr_proof_xor CHECK (num_nonnulls(proof_occurrence_id, proof_proposal_id) = 1);

-- 2. Identité/unicité : deux index partiels (un par type de preuve)
DROP INDEX IF EXISTS public.dcr_identity_uniq;
CREATE UNIQUE INDEX dcr_identity_uniq ON public.document_completion_resolution
  (proof_occurrence_id, policy_version, context_fingerprint) WHERE proof_occurrence_id IS NOT NULL;
CREATE UNIQUE INDEX dcr_proposal_identity_uniq ON public.document_completion_resolution
  (proof_proposal_id, policy_version, context_fingerprint) WHERE proof_proposal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dcr_proposal_idx ON public.document_completion_resolution (proof_proposal_id)
  WHERE proof_proposal_id IS NOT NULL;

-- 3. RPC atomique étendue — UN SEUL chemin transactionnel acceptant les deux références.
--    (DROP + CREATE : ajout d'un paramètre → signature modifiée, CREATE OR REPLACE ne suffit pas.)
DROP FUNCTION IF EXISTS public.persist_document_completion_resolution(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB);

CREATE FUNCTION public.persist_document_completion_resolution(
  p_site_id             UUID,
  p_proof_occurrence_id UUID,
  p_policy_version      TEXT,
  p_context_fingerprint TEXT,
  p_decision            TEXT,
  p_confidence_class    TEXT,
  p_selected_cbo_id     UUID,
  p_reasoning           TEXT,
  p_resolver_source     TEXT,
  p_model               TEXT,
  p_model_version       TEXT,
  p_candidates          JSONB,
  p_proof_proposal_id   UUID DEFAULT NULL
) RETURNS TABLE(kind TEXT, resolution_id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing UUID;
  v_id       UUID;
BEGIN
  -- Idempotence par (réf de preuve renseignée, policy, fingerprint) — une seule des deux réfs.
  SELECT id INTO v_existing
  FROM public.document_completion_resolution
  WHERE policy_version = p_policy_version
    AND context_fingerprint = p_context_fingerprint
    AND ( (p_proof_occurrence_id IS NOT NULL AND proof_occurrence_id = p_proof_occurrence_id)
       OR (p_proof_proposal_id  IS NOT NULL AND proof_proposal_id  = p_proof_proposal_id) );
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT 'already_exists'::TEXT, v_existing;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.document_completion_resolution(
      site_id, proof_occurrence_id, proof_proposal_id, policy_version, context_fingerprint,
      decision, confidence_class, selected_cbo_id, reasoning,
      resolver_source, model, model_version
    ) VALUES (
      p_site_id, p_proof_occurrence_id, p_proof_proposal_id, p_policy_version, p_context_fingerprint,
      p_decision, p_confidence_class, p_selected_cbo_id, p_reasoning,
      COALESCE(p_resolver_source, 'llm'), p_model, p_model_version
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing
    FROM public.document_completion_resolution
    WHERE policy_version = p_policy_version
      AND context_fingerprint = p_context_fingerprint
      AND ( (p_proof_occurrence_id IS NOT NULL AND proof_occurrence_id = p_proof_occurrence_id)
         OR (p_proof_proposal_id  IS NOT NULL AND proof_proposal_id  = p_proof_proposal_id) );
    RETURN QUERY SELECT 'already_exists'::TEXT, v_existing;
    RETURN;
  END;

  IF jsonb_array_length(COALESCE(p_candidates, '[]'::JSONB)) > 0 THEN
    INSERT INTO public.document_completion_candidate(
      resolution_id, canonical_business_object_id, candidate_verdict, intent_match, evidence_directness, reason
    )
    SELECT
      v_id,
      (c->>'canonicalBusinessObjectId')::UUID,
      c->>'verdict',
      c->>'intentMatch',
      NULLIF(c->>'evidenceDirectness', ''),
      c->>'reason'
    FROM jsonb_array_elements(p_candidates) AS c;
  END IF;

  RETURN QUERY SELECT 'created'::TEXT, v_id;
END;
$$;
