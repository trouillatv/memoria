-- 344_merge_safety_p15a1.sql
-- P1-5A.1 — Merge safety & auditability
--
-- Lot : rendre le chemin de merge safe, traçable et générique avant toute
-- re-canonicalisation P1-5B. Aucune mutation OCEF. Aucun backfill historique.
--
-- 1. Étend resolution_source pour permettre 'automatic' (fusions P1-5B).
-- 2. Ajoute engine_version, p01_jaccard, p02_confidence à canonical_subject_merge.
-- 3. Remplace merge_canonical_subjects() pour gérer canonical_subject_links :
--    — self-links détectés et supprimés (evidence en CASCADE)
--    — duplicates détectés et supprimés (lien winner conservé déterministiquement)
--    — liens reroutés loser→winner
--    — stats retournées dans le résumé JSONB.
--
-- Note sur le snapshot JSONB :
--    moved_link_ids, deleted_self_link_ids, deleted_duplicate_link_ids et
--    links_snapshot_before sont renseignés par la couche TypeScript (voir
--    merge-actions.ts et canonical-subject-merge.ts) afin de disposer des IDs
--    et du snapshot complet pour un rollback précis.
--
-- Dette documentée :
--    Les 186 fusions historiques antérieures à cette migration n'ont pas de journal
--    structuré. Elles sont classées LEGACY_UNAUDITED_MERGES. À partir de P1-5B :
--    zéro nouvelle fusion sans journal complet et engine_version renseigné.

-- ── 1. Étendre resolution_source ─────────────────────────────────────────────────

-- Supprimer la contrainte anonyme (PostgreSQL la nomme automatiquement)
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.canonical_subject_merge'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%resolution_source%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.canonical_subject_merge DROP CONSTRAINT %I', v_conname);
  END IF;
END;
$$;

ALTER TABLE public.canonical_subject_merge
  ADD CONSTRAINT canonical_subject_merge_resolution_source_check
  CHECK (resolution_source IN ('llm', 'manual', 'automatic'));

-- ── 2. Colonnes de traçabilité structurées ────────────────────────────────────────

ALTER TABLE public.canonical_subject_merge
  ADD COLUMN IF NOT EXISTS engine_version   TEXT,       -- ex. 'p1-5b-v1' | NULL pour fusions manuelles
  ADD COLUMN IF NOT EXISTS p01_jaccard      NUMERIC(4,3),  -- score Jaccard P0-1 ayant produit le candidat
  ADD COLUMN IF NOT EXISTS p02_confidence   SMALLINT;   -- confiance P0-2 (0-100)

COMMENT ON COLUMN public.canonical_subject_merge.engine_version IS
  'Version du moteur ayant déclenché la fusion. NULL pour les fusions manuelles ou antérieures à P1-5A.1.';
COMMENT ON COLUMN public.canonical_subject_merge.p01_jaccard IS
  'Score Jaccard normalisé P0-1 (0-1) ayant rendu les sujets candidats. NULL si fusion manuelle.';
COMMENT ON COLUMN public.canonical_subject_merge.p02_confidence IS
  'Confiance P0-2 analyzeSubjectPair (0-100). NULL si fusion manuelle.';

-- ── 3. Remplacer merge_canonical_subjects() ───────────────────────────────────────
--
-- Nouveau comportement pour canonical_subject_links :
--
-- Étape A — Self-links (loser ↔ winner → deviendrait winner ↔ winner) : DELETE
-- Étape B — Duplicates loser-as-source : DELETE si winner possède déjà une arête
--           avec la même paire non ordonnée (LEAST/GREATEST)
-- Étape C — Duplicates loser-as-target : idem
-- Étape D — Reroute loser-as-source → winner
-- Étape E — Reroute loser-as-target → winner
--
-- La colonne pair_low_id/pair_high_id étant GENERATED ALWAYS AS STORED, elle se
-- met à jour automatiquement lors de l'UPDATE — aucun recalcul manuel nécessaire.
-- La contrainte UNIQUE (site_id, pair_low_id, pair_high_id) est respectée car les
-- duplicates sont supprimés avant le reroutage.
--
-- canonical_subject_link_evidence a ON DELETE CASCADE sur link_id : les preuves
-- suivent leurs liens lors de la suppression, aucune action supplémentaire requise.

CREATE OR REPLACE FUNCTION merge_canonical_subjects(
  p_source_id uuid,
  p_target_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_source          canonical_subject%ROWTYPE;
  v_target          canonical_subject%ROWTYPE;
  v_occ_moved       int := 0;
  v_sti_moved       int := 0;
  v_props_moved     int := 0;
  v_links_moved     int := 0;
  v_self_links_del  int := 0;
  v_dup_links_del   int := 0;
  v_dup_src         int := 0;
  v_dup_tgt         int := 0;
  v_src_moved       int := 0;
  v_tgt_moved       int := 0;
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

  -- 5. Déplacer canonical_subject_occurrence
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

  -- 8. canonical_subject_links — Étape A : self-links (loser ↔ winner → winner ↔ winner)
  --    Supprimer AVANT reroutage pour éviter la violation de la contrainte
  --    csl_source_target_different et les doublons transitifs.
  DELETE FROM canonical_subject_links
  WHERE (source_subject_id = p_source_id AND target_subject_id = p_target_id)
     OR (source_subject_id = p_target_id AND target_subject_id = p_source_id);
  GET DIAGNOSTICS v_self_links_del = ROW_COUNT;

  -- 9. canonical_subject_links — Étape B : duplicates loser-as-source
  --    La paire rerouted serait {winner, link.target} ; si winner a déjà ce lien → DELETE loser.
  DELETE FROM canonical_subject_links l
  WHERE l.source_subject_id = p_source_id
    AND EXISTS (
      SELECT 1 FROM canonical_subject_links w
      WHERE w.pair_low_id  = LEAST(p_target_id, l.target_subject_id)
        AND w.pair_high_id = GREATEST(p_target_id, l.target_subject_id)
    );
  GET DIAGNOSTICS v_dup_src = ROW_COUNT;

  -- 10. canonical_subject_links — Étape C : duplicates loser-as-target
  --     La paire rerouted serait {link.source, winner} ; idem.
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
    'source',              p_source_id,
    'target',              p_target_id,
    'sourceLabel',         v_source.label,
    'targetLabel',         v_target.label,
    'occurrencesMoved',    v_occ_moved,
    'threadsMoved',        v_sti_moved,
    'proposalsMoved',      v_props_moved,
    'linksMoved',          v_links_moved,
    'selfLinksDeleted',    v_self_links_del,
    'duplicateLinksDeleted', v_dup_links_del
  );
END;
$$;

COMMENT ON FUNCTION merge_canonical_subjects(uuid, uuid) IS
  'Fusionne source dans target de manière atomique. Déplace occurrences, threads, proposals et canonical_subject_links (avec suppression des self-links et duplicates). Retourne un résumé JSONB des déplacements. Journal : écrit par la couche TypeScript (merge-actions.ts ou canonical-subject-merge.ts).';
