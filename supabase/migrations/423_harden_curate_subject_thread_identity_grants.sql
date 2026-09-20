-- Migration 423 — durcissement des droits d'exécution sur curate_subject_thread_identity
--
-- Constat (revue Vincent sur le lot 422) : REVOKE ALL ... FROM PUBLIC ne retire pas un
-- EXECUTE accordé directement à un rôle nommé. Sur ce projet, les default privileges
-- accordent EXECUTE à anon/authenticated (et postgres) sur toute nouvelle fonction, en
-- plus de PUBLIC — comportement déjà observé sur curate_tracked_point_subject (419).
--
-- curate_subject_thread_identity est SECURITY DEFINER et prend p_user_id fourni par
-- l'appelant : elle ne doit être exécutable que par service_role (le wrapper TS
-- lib/db/subject-thread-curation.ts est server-only et passe par createAdminClient()).
-- On révoque donc explicitement anon et authenticated, en plus de PUBLIC.

REVOKE ALL ON FUNCTION public.curate_subject_thread_identity(UUID, UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.curate_subject_thread_identity(UUID, UUID, UUID, UUID, TEXT)
  TO service_role;
