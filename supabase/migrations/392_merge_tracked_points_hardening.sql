-- Migration 392 : durcissement de merge_tracked_points + rejet humain de paire (Phase 6E.1C)
--
-- GO explicite de Vincent après PASS de la fusion pilote 6E.1B (RUS, 199→198 actifs
-- +1 merged, idempotence et anti-cycle prouvés). 6E.1C = "productisation safe" de la
-- primitive : AUCUN nouveau merge réel n'a lieu dans ce lot. HARD STOP avant toute
-- deuxième fusion réelle.
--
-- 1. merge_tracked_points (391) durcie : ajoute la vérification qu'un candidate_id
--    fourni correspond RÉELLEMENT à la paire source↔target en cours de consolidation,
--    pas seulement que son candidate_point_id est l'une des deux extrémités. Réplique
--    en SQL, mais UNIQUEMENT pour les lignes précises fournies par l'appelant (jamais
--    une re-dérivation complète de la classification), les trois mécanismes de
--    correspondance déjà encodés par deriveCandidatePointPairs
--    (lib/knowledge/tracked-point-merge.ts) : fondation trackable_condition, membership
--    HARD scope='thread', membership HARD scope='proposal_set'. Si aucun des trois ne
--    relie le thread de la candidate à l'AUTRE extrémité de la paire, la candidate ne
--    représente pas cette paire → ABORT.
--
--    Audit des guards existants (391) au regard de la checklist Vincent :
--      - source = target                          → déjà gardé (guard 1)
--      - cross-site                                → déjà gardé (guard 5)
--      - cross-org                                 → couvert STRUCTURELLEMENT : tracked_point
--                                                     n'a pas de organization_id propre (mig 388),
--                                                     seulement site_id ; un site appartient à
--                                                     exactement une organisation (sites.organization_id
--                                                     NOT NULL) donc same site_id ⟹ same org. Aucune
--                                                     colonne à checker séparément.
--      - source/target retired                     → déjà gardé (guards 3-4, `status <> 'active'`
--                                                     couvre 'retired' comme toute valeur ≠ active)
--      - source/target CONFLICTED                   → déjà gardé (guard 6)
--      - cycle                                      → IMPOSSIBLE STRUCTURELLEMENT : source et target
--                                                     doivent tous deux être status='active' ET
--                                                     merged_into_id IS NULL (guards 3-4) au moment du
--                                                     verrouillage ; aucun chemin merged_into_id ne peut
--                                                     donc exister entre eux (un maillon intermédiaire
--                                                     aurait status='merged', ce qui bloque déjà la
--                                                     fonction). Pas de check supplémentaire nécessaire ;
--                                                     testé explicitement (tests/lib/db/
--                                                     merge-tracked-points-guards.test.ts).
--      - candidate_ids ne correspondant pas à la paire → NOUVEAU guard ci-dessous.
--      - candidate déjà rejected/accepted            → déjà gardé (`status <> 'pending'`, guard 7)
--      - candidate d'un autre site/org                → déjà gardé (guard 7, site_id check)
--
-- 2. reject_point_identity_pair : décision humaine "pas le même Point". Rejette,
--    atomiquement, EXACTEMENT les lignes tracked_point_identity_candidate désignées par
--    l'appelant (jamais les autres candidates de la composante). REJECTED reste une
--    décision locale à cette paire — PAS une contrainte CANNOT_LINK globale réutilisée
--    par un futur moteur (doctrine Vincent, mémoire négative d'identité différée).

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
  v_other_point_id uuid;
  v_corresponds boolean;
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
  --    Couvre aussi 'retired' (toute valeur ≠ 'active' est refusée) et rend tout cycle
  --    structurellement impossible (cf. commentaire de tête).
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

  -- 5. Même site — fusion inter-chantier interdite (couvre aussi le cross-org,
  --    cf. commentaire de tête : site_id ⟹ organization_id unique).
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

    -- 7bis. NOUVEAU (392) : la candidate doit RÉELLEMENT correspondre à cette paire.
    -- v_row.candidate_point_id pointe une extrémité (source ou target) ; le thread de
    -- la candidate doit être rattaché à l'AUTRE extrémité par l'un des trois mécanismes
    -- reconnus par deriveCandidatePointPairs (fondation trackable_condition, membership
    -- HARD thread, membership HARD proposal_set). Sinon la candidate ne dit rien de la
    -- paire source↔target et ne doit jamais être acceptée à l'aveugle.
    v_other_point_id := CASE WHEN v_row.candidate_point_id = p_source_id THEN p_target_id ELSE p_source_id END;

    SELECT EXISTS (
      SELECT 1 FROM public.tracked_point tp
      WHERE tp.id = v_other_point_id
        AND tp.founding_kind = 'trackable_condition'
        AND tp.founding_reference = v_row.subject_thread_id::text
    ) OR EXISTS (
      SELECT 1 FROM public.tracked_point_member tpm
      WHERE tpm.tracked_point_id = v_other_point_id
        AND tpm.subject_thread_id = v_row.subject_thread_id
        AND tpm.status = 'active'
    ) INTO v_corresponds;

    IF NOT v_corresponds THEN
      RAISE EXCEPTION 'merge_tracked_points: candidate (%) ne correspond pas à la paire %/% (thread % non rattaché à %)',
        v_candidate_id, p_source_id, p_target_id, v_row.subject_thread_id, v_other_point_id;
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
  'Phase 6E.1C — fusion atomique Point→Point durcie : redirection logique pure (status=merged, merged_into_id) + acceptation des candidates représentant exactement la paire, avec vérification explicite de correspondance thread↔extrémité (fondation ou membership HARD). Aucun déplacement de tracked_point_member/canonical_business_object/preuve. Pas un moteur généralisé — bulk merge reste HARD STOP.';

-- ── reject_point_identity_pair ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reject_point_identity_pair(
  p_candidate_ids uuid[],
  p_resolved_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_candidate_id uuid;
  v_row tracked_point_identity_candidate%ROWTYPE;
  v_site_id uuid;
  v_rejected_count int := 0;
BEGIN
  IF p_candidate_ids IS NULL OR array_length(p_candidate_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'reject_point_identity_pair: p_candidate_ids vide — au moins une candidate attendue';
  END IF;

  -- Verrouille et valide TOUTES les lignes avant d'écrire quoi que ce soit
  -- (tout-ou-rien : un seul candidate déjà résolu bloque la paire entière).
  FOREACH v_candidate_id IN ARRAY p_candidate_ids LOOP
    SELECT * INTO v_row FROM public.tracked_point_identity_candidate WHERE id = v_candidate_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reject_point_identity_pair: candidate introuvable (%)', v_candidate_id;
    END IF;
    IF v_row.status <> 'pending' THEN
      RAISE EXCEPTION 'reject_point_identity_pair: candidate (%) status=% (attendu pending)', v_candidate_id, v_row.status;
    END IF;
    IF v_site_id IS NULL THEN
      v_site_id := v_row.site_id;
    ELSIF v_row.site_id <> v_site_id THEN
      RAISE EXCEPTION 'reject_point_identity_pair: candidate (%) site_id=% différent des autres lignes de la paire (%)',
        v_candidate_id, v_row.site_id, v_site_id;
    END IF;
  END LOOP;

  UPDATE public.tracked_point_identity_candidate
  SET status = 'rejected', resolved_at = now(), resolved_by = p_resolved_by
  WHERE id = ANY(p_candidate_ids);
  GET DIAGNOSTICS v_rejected_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'candidateIds', p_candidate_ids,
    'rejectedCount', v_rejected_count,
    'resolvedBy', p_resolved_by
  );
END;
$$;

COMMENT ON FUNCTION reject_point_identity_pair(uuid[], uuid) IS
  'Phase 6E.1C — rejet humain atomique et local d''une paire de candidates ("pas le même Point"). Rejette exactement les lignes fournies, tout-ou-rien. REJECTED est une décision locale à cette paire, PAS une contrainte CANNOT_LINK globale réutilisée automatiquement par un futur moteur.';
