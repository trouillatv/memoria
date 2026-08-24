-- 348_merge_reroute_canonical_business_object.sql
-- P1-C2B.3 Gate 2 : merge_canonical_subjects() ne reroutait jamais
-- canonical_business_object.canonical_subject_id lors d'une fusion.
--
-- Preuve (audit P1-C2B.3, 2026-08-25) : aucune version historique de cette
-- fonction (311, 344, 345) ne référence canonical_business_object. Aujourd'hui
-- 0/9 CBO existants pointent vers un sujet déjà fusionné (loser) — mais rien ne
-- garantissait que ça le reste après une fusion future. On installe l'invariant
-- avant qu'une dette de références vers des losers n'apparaisse (même classe de
-- problème que MERGE-REFERENCE, déjà traitée pour canonical_subject_links en 344
-- et canonical_subject_occurrence en 345).
--
-- Fix : ajoute l'étape de reroutage source → target sur canonical_business_object,
-- symétrique aux reroutages déjà en place pour les autres tables référentes.
-- Pas de dedup nécessaire : canonical_business_object n'a aucune contrainte
-- UNIQUE sur canonical_subject_id (plusieurs CBO partagent déjà le même sujet).
--
-- Ce correctif ne change aucun invariant de mig 344/345. Il est idempotent.

CREATE OR REPLACE FUNCTION merge_canonical_subjects(
  p_source_id uuid,
  p_target_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_source              canonical_subject%ROWTYPE;
  v_target              canonical_subject%ROWTYPE;
  v_dup_occ_del         int := 0;
  v_occ_moved           int := 0;
  v_sti_moved           int := 0;
  v_props_moved         int := 0;
  v_cbo_moved           int := 0;
  v_links_moved         int := 0;
  v_self_links_del      int := 0;
  v_dup_links_del       int := 0;
  v_dup_src             int := 0;
  v_dup_tgt             int := 0;
  v_src_moved           int := 0;
  v_tgt_moved           int := 0;
BEGIN
  -- 1. Identité : source ≠ target
  IF p_source_id = p_target_id THEN
    RAISE EXCEPTION 'merge_canonical_subjects: source = target (%), fusion interdite', p_source_id;
  END IF;

  -- 2. Charger source avec verrou
  SELECT * INTO v_source FROM canonical_subject WHERE id = p_source_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_canonical_subjects: source introuvable (%)', p_source_id;
  END IF;
  IF v_source.status = 'merged' THEN
    RAISE EXCEPTION 'merge_canonical_subjects: source (%) déjà fusionné dans (%)',
      p_source_id, v_source.merged_into;
  END IF;

  -- 3. Charger target avec verrou
  SELECT * INTO v_target FROM canonical_subject WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_canonical_subjects: target introuvable (%)', p_target_id;
  END IF;
  IF v_target.status = 'merged' THEN
    RAISE EXCEPTION 'merge_canonical_subjects: target (%) déjà fusionné dans (%)',
      p_target_id, v_target.merged_into;
  END IF;

  -- 4. Même site
  IF v_source.site_id <> v_target.site_id THEN
    RAISE EXCEPTION 'merge_canonical_subjects: fusion inter-chantier interdite (source: %, target: %)',
      v_source.site_id, v_target.site_id;
  END IF;

  -- 4b. canonical_subject_occurrence — supprimer doublons AVANT reroutage
  --     Si target possède déjà une occurrence avec le même (source_kind, source_ref_id)
  --     que source, supprimer celle de source (target conserve la sienne — winner).
  --     Symétrique au dedup des canonical_subject_links (mig 344).
  DELETE FROM canonical_subject_occurrence s
  USING canonical_subject_occurrence t
  WHERE s.canonical_subject_id = p_source_id
    AND t.canonical_subject_id = p_target_id
    AND s.source_kind = t.source_kind
    AND s.source_ref_id = t.source_ref_id;
  GET DIAGNOSTICS v_dup_occ_del = ROW_COUNT;

  -- 5. Déplacer canonical_subject_occurrence restantes
  UPDATE canonical_subject_occurrence
  SET canonical_subject_id = p_target_id
  WHERE canonical_subject_id = p_source_id;
  GET DIAGNOSTICS v_occ_moved = ROW_COUNT;

  -- 6. Déplacer subject_thread_identity
  UPDATE subject_thread_identity
  SET canonical_subject_id = p_target_id
  WHERE canonical_subject_id = p_source_id;
  GET DIAGNOSTICS v_sti_moved = ROW_COUNT;

  -- 7. Mettre à jour site_knowledge_proposals
  UPDATE site_knowledge_proposals
  SET canonical_subject_id = p_target_id
  WHERE canonical_subject_id = p_source_id;
  GET DIAGNOSTICS v_props_moved = ROW_COUNT;

  -- 7b. Reroute canonical_business_object — jamais de CBO laissé sur un loser (P1-C2B.3 Gate 2)
  UPDATE canonical_business_object
  SET canonical_subject_id = p_target_id
  WHERE canonical_subject_id = p_source_id;
  GET DIAGNOSTICS v_cbo_moved = ROW_COUNT;

  -- 8. canonical_subject_links — Étape A : self-links (loser ↔ winner → winner ↔ winner)
  DELETE FROM canonical_subject_links
  WHERE (source_subject_id = p_source_id AND target_subject_id = p_target_id)
     OR (source_subject_id = p_target_id AND target_subject_id = p_source_id);
  GET DIAGNOSTICS v_self_links_del = ROW_COUNT;

  -- 9. canonical_subject_links — Étape B : duplicates loser-as-source
  DELETE FROM canonical_subject_links l
  WHERE l.source_subject_id = p_source_id
    AND EXISTS (
      SELECT 1 FROM canonical_subject_links w
      WHERE w.pair_low_id  = LEAST(p_target_id, l.target_subject_id)
        AND w.pair_high_id = GREATEST(p_target_id, l.target_subject_id)
    );
  GET DIAGNOSTICS v_dup_src = ROW_COUNT;

  -- 10. canonical_subject_links — Étape C : duplicates loser-as-target
  DELETE FROM canonical_subject_links l
  WHERE l.target_subject_id = p_source_id
    AND EXISTS (
      SELECT 1 FROM canonical_subject_links w
      WHERE w.pair_low_id  = LEAST(l.source_subject_id, p_target_id)
        AND w.pair_high_id = GREATEST(l.source_subject_id, p_target_id)
    );
  GET DIAGNOSTICS v_dup_tgt = ROW_COUNT;

  v_dup_links_del := v_dup_src + v_dup_tgt;

  -- 11. canonical_subject_links — Étape D : reroute loser-as-source → winner-as-source
  UPDATE canonical_subject_links
  SET source_subject_id = p_target_id
  WHERE source_subject_id = p_source_id;
  GET DIAGNOSTICS v_src_moved = ROW_COUNT;

  -- 12. canonical_subject_links — Étape E : reroute loser-as-target → winner-as-target
  UPDATE canonical_subject_links
  SET target_subject_id = p_target_id
  WHERE target_subject_id = p_source_id;
  GET DIAGNOSTICS v_tgt_moved = ROW_COUNT;

  v_links_moved := v_src_moved + v_tgt_moved;

  -- 13. Marquer la source comme fusionnée
  UPDATE canonical_subject
  SET status      = 'merged',
      merged_into = p_target_id
  WHERE id = p_source_id;

  RETURN jsonb_build_object(
    'source',                       p_source_id,
    'target',                       p_target_id,
    'sourceLabel',                  v_source.label,
    'targetLabel',                  v_target.label,
    'occurrencesMoved',             v_occ_moved,
    'duplicateOccurrencesDeleted',  v_dup_occ_del,
    'threadsMoved',                 v_sti_moved,
    'proposalsMoved',               v_props_moved,
    'canonicalBusinessObjectsMoved', v_cbo_moved,
    'linksMoved',                   v_links_moved,
    'selfLinksDeleted',             v_self_links_del,
    'duplicateLinksDeleted',        v_dup_links_del
  );
END;
$$;

COMMENT ON FUNCTION merge_canonical_subjects(uuid, uuid) IS
  'Fusionne source dans target de manière atomique. Gère canonical_subject_occurrence (avec dedup), subject_thread_identity, site_knowledge_proposals, canonical_business_object (reroutage, sans dedup) et canonical_subject_links (avec self-links et dedup). Retourne un résumé JSONB complet. Journal : écrit par la couche TypeScript.';

-- Pas de backfill de données dans cette migration : l'audit P1-C2B.3 (2026-08-25,
-- gate2-merge-chain-audit-out.txt) a prouvé 0/9 canonical_business_object déjà
-- fusionnés stale au moment de l'écriture — rien à corriger rétroactivement.
