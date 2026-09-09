-- P6 Live Writer — harness de test EXCLUSIF (témoin 14, rollback réel après INSERT tracked_point).
--
-- Ce fichier N'EST PAS une migration : il vit hors de supabase/migrations/ et n'est JAMAIS
-- appliqué automatiquement par le runner de migrations, ni par aucun déploiement (dev, staging,
-- prod). Il n'est chargé qu'explicitement, à la main, sur une base JETABLE, pour exécuter le
-- témoin 14 de la matrice de tests (docs/tracked-points/p6-live-writer-design.md §5).
--
-- Pourquoi ce détour et pas un paramètre RPC prod (ex. p_fail_after_point_insert=true) :
-- Vincent (Round 2) — « pas un paramètre RPC activable librement depuis PostgREST. Il faut un
-- mécanisme exclusivement test, ou une fonction/test harness séparée dans une DB jetable. Je ne
-- veux pas introduire dans la fonction prod un « p_fail_after_point=true » caché. » Un paramètre
-- caché dans fn_reconcile_tracked_point_unit resterait exposé à quiconque a EXECUTE sur la
-- fonction (même après REVOKE PUBLIC/anon/authenticated, service_role reste appelant légitime
-- pour tout usage réel) — ce fichier isole le point d'injection de panne dans un schéma et une
-- fonction distincts, jamais déployés, jamais accordés à service_role de la base cible réelle.
--
-- Mécanisme : la fonction prod (migration 401) contient un failpoint conditionné par le GUC
-- `p6_test.fail_after_point_insert`, lu via `current_setting(name, missing_ok=true)` — retourne
-- NULL (donc jamais 'true') si le GUC n'a jamais été positionné. Ce fichier fournit la SEULE
-- fonction qui positionne ce GUC (`set_config(..., is_local=true)`, portée transaction), avant
-- d'appeler la fonction prod inchangée. Aucune autre voie ne peut positionner ce GUC en dehors
-- d'une session qui a explicitement chargé ce harness.
--
-- Usage attendu (témoin 14) : charger ce fichier sur la DB jetable APRÈS les migrations 400/401,
-- appeler test_only.fn_reconcile_tracked_point_unit_with_failpoint(...) avec un plan qui
-- provoque CREATE_POINT_WITH_MEMBERSHIP[_AND_CBO_LINK], vérifier que l'appel échoue avec
-- TEST_INDUCED_FAILURE_AFTER_POINT_INSERT, puis vérifier qu'aucune ligne n'a survécu (0 Point,
-- 0 member, 0 CBO modifié, 0 state/event/artifact) — preuve de rollback atomique réel, pas
-- simulée.

CREATE SCHEMA IF NOT EXISTS test_only;

CREATE OR REPLACE FUNCTION test_only.fn_reconcile_tracked_point_unit_with_failpoint(
  p_site_id UUID,
  p_unit_key TEXT,
  p_thread_id UUID,
  p_scope TEXT,
  p_input_snapshot JSONB,
  p_input_fingerprint TEXT,
  p_source_kind TEXT,
  p_source_ref_id UUID,
  p_planned_point JSONB DEFAULT NULL,
  p_planned_pending_trace JSONB DEFAULT NULL,
  p_cross_thread_candidate_point_ids UUID[] DEFAULT '{}'::UUID[]
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  -- Portée transaction (is_local=true) : le GUC ne fuit jamais hors de cet appel, même si la
  -- session est réutilisée par un pool de connexions ensuite.
  PERFORM set_config('p6_test.fail_after_point_insert', 'true', true);

  RETURN public.fn_reconcile_tracked_point_unit(
    p_site_id, p_unit_key, p_thread_id, p_scope, p_input_snapshot, p_input_fingerprint,
    p_source_kind, p_source_ref_id, p_planned_point, p_planned_pending_trace,
    p_cross_thread_candidate_point_ids
  );

  -- Si on atteint cette ligne, le plan fourni n'a déclenché aucun INSERT tracked_point (ex.
  -- ATTACH_MEMBER, CREATE_CANDIDATES) : le failpoint n'a pas pu être exercé, et un test qui
  -- attend TEST_INDUCED_FAILURE_AFTER_POINT_INSERT échouerait silencieusement sans ce garde-fou.
  RAISE EXCEPTION 'test_only.fn_reconcile_tracked_point_unit_with_failpoint: NO_POINT_INSERT_REACHED — le plan fourni n''a déclenché aucun INSERT tracked_point, le failpoint n''a pas pu être exercé';
END;
$$;

COMMENT ON FUNCTION test_only.fn_reconcile_tracked_point_unit_with_failpoint(
  UUID, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, UUID, JSONB, JSONB, UUID[]
) IS
  'Harness EXCLUSIF au témoin 14 (p6-live-writer-design.md §5) — jamais appliqué en migration, '
  'jamais présent sur la base cible réelle. Positionne p6_test.fail_after_point_insert=true '
  '(portée transaction) puis délègue à public.fn_reconcile_tracked_point_unit inchangée, pour '
  'prouver un rollback réel après INSERT tracked_point, sans introduire de paramètre de panne '
  'dans la fonction prod.';

-- Pas de SECURITY DEFINER : cette fonction tourne avec les privilèges du rôle qui l'appelle (le
-- test runner, déjà propriétaire de la DB jetable) — aucun durcissement de privilège nécessaire
-- puisqu'elle n'est jamais déployée sur une base où un appelant non habilité pourrait l'atteindre.
