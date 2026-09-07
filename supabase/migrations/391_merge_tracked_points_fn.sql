-- Migration 391 : fonction atomique de fusion Point→Point (Phase 6E.1B pilote)
--
-- GO explicite de Vincent, scope STRICTEMENT limité à l'exécution d'UNE fusion pilote
-- sur RUS (cf. 6E.1B). Ce n'est PAS un moteur de fusion généralisé — la généralisation
-- (6E.1C) reste un HARD STOP séparé. merge_tracked_points() encode uniquement la forme
-- de transaction exacte validée par Vincent :
--
--   BEGIN
--   lock A + B
--   re-vérifier état/site/identity_status
--   UPDATE tracked_point SET status='merged', merged_into_id=target
--   UPDATE tracked_point_identity_candidate SET status='accepted', resolved_at=now()
--     WHERE id = ANY(candidate_ids fournis par l'appelant)
--   COMMIT
--
-- Aucune autre écriture : 0 UPDATE tracked_point_member, 0 UPDATE
-- canonical_business_object, 0 copie de preuve, 0 changement founding_reference,
-- 0 suppression de Point, 0 rejet automatique d'autres candidates.
--
-- p_candidate_ids n'est jamais re-dérivé en SQL : la classification Point↔Point
-- (deriveCandidatePointPairs, lib/knowledge/tracked-point-merge.ts, testée et gelée
-- en 6E.1A) reste l'unique source de vérité pour identifier QUELLES lignes
-- représentent la paire. La fonction ne fait que verrouiller et re-valider ces lignes
-- précises avant de les accepter — jamais deviner un ensemble de son côté.
--
-- MERGE reste une redirection logique pure (doctrine 6E.1A, tracked-point-merge.ts
-- lignes 1-17) : aucun déplacement physique de tracked_point_member,
-- canonical_business_object.tracked_point_id, founding_reference ou preuve.

CREATE OR REPLACE FUNCTION merge_tracked_points(
  p_source_id uuid,
  p_target_id uuid,
  p_candidate_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_source tracked_point%ROWTYPE;
  v_target tracked_point%ROWTYPE;
  v_candidate_id uuid;
  v_row tracked_point_identity_candidate%ROWTYPE;
  v_candidates_accepted int := 0;
BEGIN
  -- 1. Identité : source ≠ target
  IF p_source_id = p_target_id THEN
    RAISE EXCEPTION 'merge_tracked_points: source = target (%), fusion interdite', p_source_id;
  END IF;

  -- 2. Charger + verrouiller source
  SELECT * INTO v_source FROM public.tracked_point WHERE id = p_source_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_tracked_points: source introuvable (%)', p_source_id;
  END IF;

  -- 3. Charger + verrouiller target
  SELECT * INTO v_target FROM public.tracked_point WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_tracked_points: target introuvable (%)', p_target_id;
  END IF;

  -- 4. Re-vérification de l'état (re-résolution canonique) : les deux doivent être
  --    actives et non déjà fusionnées — un merge n'est jamais appliqué sur un Point
  --    déjà redirigé, même par un run concurrent survenu entre le préflight et l'écriture.
  IF v_source.status <> 'active' THEN
    RAISE EXCEPTION 'merge_tracked_points: source (%) status=% (attendu active)', p_source_id, v_source.status;
  END IF;
  IF v_target.status <> 'active' THEN
    RAISE EXCEPTION 'merge_tracked_points: target (%) status=% (attendu active)', p_target_id, v_target.status;
  END IF;
  IF v_source.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'merge_tracked_points: source (%) a déjà merged_into_id=%', p_source_id, v_source.merged_into_id;
  END IF;
  IF v_target.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'merge_tracked_points: target (%) a déjà merged_into_id=%', p_target_id, v_target.merged_into_id;
  END IF;

  -- 5. Même site — fusion inter-chantier interdite
  IF v_source.site_id <> v_target.site_id THEN
    RAISE EXCEPTION 'merge_tracked_points: fusion inter-chantier interdite (source site: %, target site: %)',
      v_source.site_id, v_target.site_id;
  END IF;

  -- 6. Doctrine CONFLICTED (Vincent, gelée 6E.1A/6E.1B) : l'identité ne doit jamais
  --    faire disparaître le signal CONFLICTED via une sélection automatique de gagnant.
  IF v_source.identity_status = 'CONFLICTED' OR v_target.identity_status = 'CONFLICTED' THEN
    RAISE EXCEPTION 'merge_tracked_points: identity_status CONFLICTED — fusion automatique interdite (source: %, target: %)',
      v_source.identity_status, v_target.identity_status;
  END IF;

  -- 7. Verrouiller + valider chaque candidate explicitement désignée par l'appelant
  --    (dérivée hors transaction par deriveCandidatePointPairs, jamais recalculée ici).
  IF p_candidate_ids IS NULL OR array_length(p_candidate_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'merge_tracked_points: p_candidate_ids vide — au moins une candidate attendue';
  END IF;

  FOREACH v_candidate_id IN ARRAY p_candidate_ids LOOP
    SELECT * INTO v_row FROM public.tracked_point_identity_candidate WHERE id = v_candidate_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'merge_tracked_points: candidate introuvable (%)', v_candidate_id;
    END IF;
    IF v_row.status <> 'pending' THEN
      RAISE EXCEPTION 'merge_tracked_points: candidate (%) status=% (attendu pending)', v_candidate_id, v_row.status;
    END IF;
    IF v_row.candidate_point_id <> p_source_id AND v_row.candidate_point_id <> p_target_id THEN
      RAISE EXCEPTION 'merge_tracked_points: candidate (%) candidate_point_id=% ne cible ni source ni target',
        v_candidate_id, v_row.candidate_point_id;
    END IF;
    IF v_row.site_id <> v_source.site_id THEN
      RAISE EXCEPTION 'merge_tracked_points: candidate (%) site_id=% différent du site de fusion',
        v_candidate_id, v_row.site_id;
    END IF;

    UPDATE public.tracked_point_identity_candidate
    SET status = 'accepted', resolved_at = now()
    WHERE id = v_candidate_id;
    v_candidates_accepted := v_candidates_accepted + 1;
  END LOOP;

  -- 8. Seule écriture d'identité : redirection logique pure. Rien d'autre n'est
  --    modifié — tracked_point_member, canonical_business_object, founding_reference
  --    et les preuves documentaires restent physiquement attachées à p_source_id.
  UPDATE public.tracked_point
  SET status = 'merged', merged_into_id = p_target_id
  WHERE id = p_source_id;

  RETURN jsonb_build_object(
    'source', p_source_id,
    'target', p_target_id,
    'sourceLabel', v_source.label,
    'targetLabel', v_target.label,
    'candidatesAccepted', v_candidates_accepted
  );
END;
$$;

COMMENT ON FUNCTION merge_tracked_points(uuid, uuid, uuid[]) IS
  'Phase 6E.1B — fusion atomique Point→Point pilote : redirection logique pure (status=merged, merged_into_id) + acceptation des candidates représentant exactement la paire (fournies par l''appelant, jamais re-dérivées en SQL). Aucun déplacement de tracked_point_member/canonical_business_object/preuve. Pas un moteur généralisé — 6E.1C reste HARD STOP.';
