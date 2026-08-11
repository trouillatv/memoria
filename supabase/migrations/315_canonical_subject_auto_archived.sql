-- 315_canonical_subject_auto_archived.sql
--
-- Étend le statut de canonical_subject avec 'auto_archived'.
--
-- auto_archived = sujet actuellement sans occurrence active, pas définitivement mort.
-- Un sujet auto_archived peut être réactivé ('active') si une nouvelle occurrence
-- fiable le correspond — l'identité canonique est préservée.
--
-- Invariants :
--   - Seuls les sujets à création automatique (auto_visit, auto_meeting, historical_pv)
--     peuvent être auto-archivés. Les sujets 'manual' ne le sont jamais.
--   - Un sujet merged ou split ne peut pas être réactivé via auto_archived.
--   - La réactivation se fait uniquement via UPDATE ... WHERE status='auto_archived'.

-- Supprime l'ancienne contrainte CHECK et la recrée avec 'auto_archived'
ALTER TABLE public.canonical_subject
  DROP CONSTRAINT IF EXISTS canonical_subject_status_check;

ALTER TABLE public.canonical_subject
  ADD CONSTRAINT canonical_subject_status_check
  CHECK (status IN ('active', 'merged', 'split', 'auto_archived'));

-- Index étendu : inclut les sujets auto_archived pour que le résolveur les trouve rapidement
DROP INDEX IF EXISTS idx_canonical_subject_status;
CREATE INDEX idx_canonical_subject_status
  ON public.canonical_subject(site_id, status)
  WHERE status IN ('active', 'auto_archived');
