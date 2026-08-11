-- 313_evolution_shadow.sql
--
-- Table de journalisation des verdicts V2 (shadow mode).
--
-- Chaque ligne = un verdict calculé par classifySubjectEvolutionV2() pour une
-- paire consécutive d'événements (T1 → T2) d'un canonical_subject.
--
-- Garanties :
--   - Aucun impact sur les métriques officielles (lastMeaningfulChangeAt, etc.)
--   - Idempotent par UPSERT : recalculer la même paire met à jour le résultat
--     et horodate calculated_at sans créer de doublon
--   - Déclenchement uniquement depuis le pipeline d'occurrences (pas de page load)

CREATE TABLE canonical_subject_evolution_shadow (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               uuid        NOT NULL,
  canonical_subject_id  uuid        NOT NULL,

  -- Identité de la paire T1 → T2
  event_t1_date         date        NOT NULL,
  event_t1_source_kind  text        NOT NULL,
  event_t2_date         date        NOT NULL,
  event_t2_source_kind  text        NOT NULL,

  -- États consolidés complets (ConsolidatedState v2.1)
  state_t1              jsonb       NOT NULL,
  state_t2              jsonb       NOT NULL,

  -- Verdict
  verdict               text        NOT NULL CHECK (verdict IN ('meaningful_change', 'remention', 'ambiguous')),
  pattern               text        CHECK (pattern IN ('status_transition', 'scope_change', 'operationalization', 'new_fact')),
  justification         text,
  confidence            numeric(3,2) CHECK (confidence >= 0 AND confidence <= 1),

  -- Traçabilité du moteur
  motor_version         text        NOT NULL DEFAULT 'v2.1',
  calculated_at         timestamptz NOT NULL DEFAULT now(),

  -- Contrainte d'unicité : une seule ligne par paire et version de moteur
  UNIQUE (canonical_subject_id, event_t1_date, event_t1_source_kind, event_t2_date, event_t2_source_kind, motor_version)
);

-- Accès par site (liste des verdicts d'un chantier)
CREATE INDEX idx_ces_site_calculated ON canonical_subject_evolution_shadow (site_id, calculated_at DESC);
-- Accès par sujet (historique des verdicts d'un sujet canonique)
CREATE INDEX idx_ces_subject ON canonical_subject_evolution_shadow (canonical_subject_id);

COMMENT ON TABLE canonical_subject_evolution_shadow IS
  'Verdicts shadow V2 — calculés en arrière-plan, jamais écrits dans les métriques officielles.';
