-- Migration 281 — Lot 3 : validation humaine des rapprochements sémantiques
--
-- Ajoute :
--   1. previous_canonical_subject_id sur canonical_subject_suggestion — nécessaire
--      pour l'undo d'un Accept (restaurer l'identité thread avant le merge).
--   2. RPC accept_subject_suggestion — transactionnel (lock + 2 tables en 1 tx).
--   3. RPC undo_accept_subject_suggestion — transactionnel avec garde d'obsolescence.
--
-- Reject et Undo Reject n'écrivent que dans canonical_subject_suggestion
-- → pas besoin de RPC, une simple UPDATE server-side suffit.
--
-- Philosophie :
--   - Un rejet porte sur une PAIRE (thread → candidate), pas sur le thread entier.
--   - Un undo d'Accept est refusé si le thread a déjà été réassigné depuis
--     (décision humaine plus récente → ne pas écraser).
--   - Les canonical_subject devenus orphelins après un merge ne sont pas supprimés :
--     ils constituent de l'historique, nettoyage différé.

-- ── 1. Colonne pour l'undo ────────────────────────────────────────────────────

ALTER TABLE public.canonical_subject_suggestion
  ADD COLUMN previous_canonical_subject_id UUID
    REFERENCES public.canonical_subject(id) ON DELETE SET NULL;

-- ── 2. RPC accept_subject_suggestion ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accept_subject_suggestion(
  p_suggestion_id UUID,
  p_user_id       UUID
)
RETURNS TEXT          -- 'ok' | 'not_found' | 'not_pending' | 'invalid_candidate' | 'invalid_thread' | 'already_used'
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sug  public.canonical_subject_suggestion%ROWTYPE;
  v_sti  public.subject_thread_identity%ROWTYPE;
  v_cs   public.canonical_subject%ROWTYPE;
BEGIN
  -- Verrouille la suggestion pour éviter les doubles clics concurrents
  SELECT * INTO v_sug
  FROM public.canonical_subject_suggestion
  WHERE id = p_suggestion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  -- Doit être pending
  IF v_sug.resolution != 'pending' THEN
    RETURN 'not_pending';
  END IF;

  -- Pas déjà en cours d'acceptation (idempotence)
  IF v_sug.previous_canonical_subject_id IS NOT NULL THEN
    RETURN 'already_used';
  END IF;

  -- Le candidat doit exister, être actif et appartenir au même site
  SELECT * INTO v_cs
  FROM public.canonical_subject
  WHERE id     = v_sug.candidate_canonical_subject_id
    AND site_id = v_sug.site_id
    AND status  = 'active';

  IF NOT FOUND THEN
    RETURN 'invalid_candidate';
  END IF;

  -- Le thread doit exister dans subject_thread_identity et appartenir au même site
  SELECT * INTO v_sti
  FROM public.subject_thread_identity
  WHERE subject_thread_id = v_sug.subject_thread_id;

  IF NOT FOUND THEN
    RETURN 'invalid_thread';
  END IF;

  IF v_sti.site_id != v_sug.site_id THEN
    RETURN 'invalid_thread';
  END IF;

  -- Mémorise l'ancienne identité pour permettre l'undo
  -- Puis rattache le thread au candidat
  UPDATE public.subject_thread_identity
  SET canonical_subject_id = v_sug.candidate_canonical_subject_id,
      source               = 'manual',
      reviewed_at          = now(),
      reviewed_by          = p_user_id
  WHERE subject_thread_id = v_sug.subject_thread_id;

  UPDATE public.canonical_subject_suggestion
  SET previous_canonical_subject_id = v_sti.canonical_subject_id,
      resolution                     = 'accepted',
      resolved_at                    = now(),
      resolved_by                    = p_user_id
  WHERE id = p_suggestion_id;

  RETURN 'ok';
END;
$$;

-- ── 3. RPC undo_accept_subject_suggestion ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.undo_accept_subject_suggestion(
  p_suggestion_id UUID,
  p_user_id       UUID
)
RETURNS TEXT          -- 'ok' | 'not_found' | 'not_accepted' | 'no_previous' | 'stale_undo' | 'invalid_thread'
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sug public.canonical_subject_suggestion%ROWTYPE;
  v_sti public.subject_thread_identity%ROWTYPE;
BEGIN
  SELECT * INTO v_sug
  FROM public.canonical_subject_suggestion
  WHERE id = p_suggestion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_sug.resolution != 'accepted' THEN
    RETURN 'not_accepted';
  END IF;

  IF v_sug.previous_canonical_subject_id IS NULL THEN
    RETURN 'no_previous';
  END IF;

  SELECT * INTO v_sti
  FROM public.subject_thread_identity
  WHERE subject_thread_id = v_sug.subject_thread_id;

  IF NOT FOUND THEN
    RETURN 'invalid_thread';
  END IF;

  -- Garde d'obsolescence : le thread doit encore pointer vers le candidate accepté.
  -- Si ce n'est plus le cas, une décision humaine plus récente a réassigné le thread
  -- → refus silencieux pour ne pas écraser cette décision.
  IF v_sti.canonical_subject_id != v_sug.candidate_canonical_subject_id THEN
    RETURN 'stale_undo';
  END IF;

  -- Restaure l'identité précédente
  UPDATE public.subject_thread_identity
  SET canonical_subject_id = v_sug.previous_canonical_subject_id,
      source               = 'auto',
      reviewed_at          = NULL,
      reviewed_by          = NULL
  WHERE subject_thread_id = v_sug.subject_thread_id;

  -- Réinitialise la suggestion en pending
  UPDATE public.canonical_subject_suggestion
  SET previous_canonical_subject_id = NULL,
      resolution                     = 'pending',
      resolved_at                    = NULL,
      resolved_by                    = NULL
  WHERE id = p_suggestion_id;

  RETURN 'ok';
END;
$$;
