-- Migration 382 : persistance ATOMIQUE résolution + candidats (P1-4B-ATOMICITÉ, P0 technique)
--
-- Défaut corrigé : le chemin applicatif insérait le PARENT (document_completion_resolution) puis les
-- ENFANTS (document_completion_candidate) en DEUX requêtes. Un parent commité + un échec candidat
-- laissait une résolution EFFECTIVE partielle (parent sans candidats), et le retry renvoyait
-- `already_exists` → candidats jamais réinsérés. Cela viole le modèle append-only/rejouable.
--
-- Correctif : une fonction plpgsql est atomique — parent + candidats vivent dans la MÊME transaction.
-- Un échec (CHECK candidat, FK, etc.) provoque le rollback INTÉGRAL : aucun parent partiel visible.
--
-- Identité inchangée : idempotence par (proof_occurrence_id, policy_version, context_fingerprint),
-- exactement comme le chemin actuel. Le fingerprint reste calculé côté application (sha256) et passé
-- en paramètre — la RPC ne change ni la policy, ni le fingerprint, ni la sémantique de décision.
--
-- Course concurrente : si deux appels passent le pré-check simultanément, le perdant capte
-- unique_violation (index dcr_identity_uniq) et renvoie `already_exists` sur la ligne gagnante —
-- une seule résolution logique, jamais de doublon, jamais de candidats orphelins.
--
-- Additif et idempotent : CREATE OR REPLACE FUNCTION. Aucune donnée existante touchée.

CREATE OR REPLACE FUNCTION public.persist_document_completion_resolution(
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
  p_candidates          JSONB
) RETURNS TABLE(kind TEXT, resolution_id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing UUID;
  v_id       UUID;
BEGIN
  -- Idempotence : une résolution logique par (preuve, policy, contexte).
  SELECT id INTO v_existing
  FROM public.document_completion_resolution
  WHERE proof_occurrence_id = p_proof_occurrence_id
    AND policy_version      = p_policy_version
    AND context_fingerprint = p_context_fingerprint;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT 'already_exists'::TEXT, v_existing;
    RETURN;
  END IF;

  -- Insert parent — capte la course concurrente sur l'index d'unicité.
  BEGIN
    INSERT INTO public.document_completion_resolution(
      site_id, proof_occurrence_id, policy_version, context_fingerprint,
      decision, confidence_class, selected_cbo_id, reasoning,
      resolver_source, model, model_version
    ) VALUES (
      p_site_id, p_proof_occurrence_id, p_policy_version, p_context_fingerprint,
      p_decision, p_confidence_class, p_selected_cbo_id, p_reasoning,
      COALESCE(p_resolver_source, 'llm'), p_model, p_model_version
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing
    FROM public.document_completion_resolution
    WHERE proof_occurrence_id = p_proof_occurrence_id
      AND policy_version      = p_policy_version
      AND context_fingerprint = p_context_fingerprint;
    RETURN QUERY SELECT 'already_exists'::TEXT, v_existing;
    RETURN;
  END;

  -- Candidats — même transaction que le parent. Tout échec (CHECK/FK) fait remonter l'exception,
  -- annulant AUSSI l'insert parent ci-dessus (rollback intégral de la fonction).
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
