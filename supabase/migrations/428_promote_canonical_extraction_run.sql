-- P0 Unicite des runs historiques -- transfert atomique du run canonique
-- vers le run reellement finalise par l'humain (materialize_historical_visit
-- reussi), sans jamais supprimer ni marquer "superseded" l'ancien run.
--
-- Invariant : au plus un run canonique par document (index unique partiel,
-- migration 277). Cette fonction desactive l'ancien canonique et active le
-- nouveau dans une seule transaction PL/pgSQL, donc jamais d'etat
-- intermediaire visible ni de violation de l'index partiel.
--
-- Idempotente : si p_run_id est deja le canonique, no-op (retourne true).
-- Ne fait rien si p_run_id n'appartient pas a p_document_id.

CREATE OR REPLACE FUNCTION public.promote_canonical_extraction_run(
  p_document_id uuid,
  p_run_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_canonical boolean;
BEGIN
  SELECT is_canonical INTO v_already_canonical
  FROM public.document_extraction_run
  WHERE id = p_run_id AND document_id = p_document_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_already_canonical THEN
    RETURN true;
  END IF;

  UPDATE public.document_extraction_run
  SET is_canonical = false
  WHERE document_id = p_document_id
    AND is_canonical = true
    AND id <> p_run_id;

  UPDATE public.document_extraction_run
  SET is_canonical = true
  WHERE id = p_run_id
    AND document_id = p_document_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.promote_canonical_extraction_run(uuid, uuid) IS
  'Transfert atomique du statut is_canonical vers le run finalise (materialize_historical_visit reussi). Ne supprime rien, pas de statut superseded.';
