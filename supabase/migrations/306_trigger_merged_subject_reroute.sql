-- 306 : trigger qui reroute STI et occurrences quand un sujet est fusionné
--
-- Problème résolu : des fusions faites hors de mergeCanonicalSubjectsAction
-- (SQL direct, scripts ad-hoc) ne reroutaient pas subject_thread_identity
-- ni canonical_subject_occurrence vers le winner, laissant le loser visible
-- dans la matrice et les autres vues construites depuis ces tables.
--
-- Solution : trigger AFTER UPDATE sur canonical_subject.
-- Si le status passe à 'merged' et que merged_into est renseigné,
-- on reroute automatiquement STI et occurrences vers le winner.
-- Ce trigger complète le 305 (qui gère canonical_topic_subject).

CREATE OR REPLACE FUNCTION reroute_merged_subject_relations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'merged' AND (OLD.status IS DISTINCT FROM 'merged') AND NEW.merged_into IS NOT NULL THEN
    UPDATE subject_thread_identity
    SET canonical_subject_id = NEW.merged_into
    WHERE canonical_subject_id = NEW.id;

    UPDATE canonical_subject_occurrence
    SET canonical_subject_id = NEW.merged_into
    WHERE canonical_subject_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reroute_merged_subject_relations ON canonical_subject;

CREATE TRIGGER trg_reroute_merged_subject_relations
AFTER UPDATE ON canonical_subject
FOR EACH ROW
EXECUTE FUNCTION reroute_merged_subject_relations();
