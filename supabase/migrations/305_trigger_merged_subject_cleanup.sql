-- 305 : trigger qui nettoie canonical_topic_subject quand un sujet est fusionné
--
-- Problème résolu : des fusions faites hors de mergeCanonicalSubjectsAction
-- (SQL direct, scripts ad-hoc) ne retiraient pas le loser de son topic,
-- laissant des lignes orphelines dans canonical_topic_subject.
--
-- Solution : trigger AFTER UPDATE sur canonical_subject.
-- Si le status passe à 'merged', on supprime automatiquement toute entrée
-- dans canonical_topic_subject pour ce sujet.

CREATE OR REPLACE FUNCTION remove_merged_subject_from_topics()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'merged' AND (OLD.status IS DISTINCT FROM 'merged') THEN
    DELETE FROM canonical_topic_subject
    WHERE canonical_subject_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_remove_merged_subject_from_topics ON canonical_subject;

CREATE TRIGGER trg_remove_merged_subject_from_topics
AFTER UPDATE ON canonical_subject
FOR EACH ROW
EXECUTE FUNCTION remove_merged_subject_from_topics();
