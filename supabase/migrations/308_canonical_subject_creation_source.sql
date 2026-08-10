-- Traçabilité de l'origine d'un canonical_subject.
-- Valeurs : 'manual' | 'historical_pv' | 'auto_visit' | 'auto_meeting' | 'actor_link'
-- NULL = créé avant cette migration (inconnu).
ALTER TABLE canonical_subject
  ADD COLUMN IF NOT EXISTS creation_source TEXT;
