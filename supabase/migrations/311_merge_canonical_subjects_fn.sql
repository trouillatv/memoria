-- Migration 311 : fonction atomique de fusion de canonical_subject
--
-- merge_canonical_subjects(source, target) déplace toutes les références
-- du sujet source vers le sujet target, puis marque source comme 'merged'.
--
-- Garanties :
--   * transaction unique — aucun état partiel possible
--   * source ≠ target
--   * source et target doivent appartenir au même site
--   * source ne doit pas être déjà fusionné (status = 'merged')
--   * target ne doit pas être déjà fusionné (status = 'merged')
--   * retourne un résumé JSONB des déplacements effectués

CREATE OR REPLACE FUNCTION merge_canonical_subjects(
  p_source_id uuid,
  p_target_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_source canonical_subject%ROWTYPE;
  v_target canonical_subject%ROWTYPE;
  v_occ_moved     int := 0;
  v_sti_moved     int := 0;
  v_props_moved   int := 0;
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
    RAISE EXCEPTION 'merge_canonical_subjects: fusion inter-chantier interdite (source site: %, target site: %)',
      v_source.site_id, v_target.site_id;
  END IF;

  -- 5. Anti-boucle : target ne doit pas pointer vers source
  --    (v_target.merged_into est NULL car target est active — vérification simple)
  --    Note : source est active, donc aucun descendant de source ne peut être target.

  -- 6. Déplacer canonical_subject_occurrence
  UPDATE canonical_subject_occurrence
  SET canonical_subject_id = p_target_id
  WHERE canonical_subject_id = p_source_id;
  GET DIAGNOSTICS v_occ_moved = ROW_COUNT;

  -- 7. Déplacer subject_thread_identity
  UPDATE subject_thread_identity
  SET canonical_subject_id = p_target_id
  WHERE canonical_subject_id = p_source_id;
  GET DIAGNOSTICS v_sti_moved = ROW_COUNT;

  -- 8. Mettre à jour site_knowledge_proposals
  UPDATE site_knowledge_proposals
  SET canonical_subject_id = p_target_id
  WHERE canonical_subject_id = p_source_id;
  GET DIAGNOSTICS v_props_moved = ROW_COUNT;

  -- 9. Marquer la source comme fusionnée
  UPDATE canonical_subject
  SET status      = 'merged',
      merged_into = p_target_id
  WHERE id = p_source_id;

  RETURN jsonb_build_object(
    'source',         p_source_id,
    'target',         p_target_id,
    'sourceLabel',    v_source.label,
    'targetLabel',    v_target.label,
    'occurrencesMoved', v_occ_moved,
    'threadsMoved',     v_sti_moved,
    'proposalsMoved',   v_props_moved
  );
END;
$$;

COMMENT ON FUNCTION merge_canonical_subjects(uuid, uuid) IS
  'Fusionne source dans target de manière atomique. Déplace occurrences, threads et proposals. Marque source comme merged.';
