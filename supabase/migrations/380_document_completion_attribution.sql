-- Migration 380 : pont documentaire de complétion — persistance des résolutions (P1-4B1)
--
-- P1-4B a démontré (calibration V2, RUS) qu'un resolver borné peut attribuer une PREUVE de
-- réalisation documentaire (knowledge_fact resolved) à l'intention d'action durable (CBO)
-- qu'elle accomplit, avec une precision HIGH de 100 % + validation hors calibration sans faux
-- positif. Ce lot persiste UNIQUEMENT ces résolutions ; il ne les CONSOMME PAS encore.
--
-- Architecture (gelée par Vincent) :
--   - Le documentaire est une INFÉRENCE RÉVISABLE : il n'écrit JAMAIS dans
--     object_state_occurrence_signal (réservé aux faits événementiels : import + natif P1-4A).
--   - Chaîne cible : preuve immuable → résolution versionnée APPEND-ONLY → décision effective
--     DÉRIVÉE (jamais un flag is_effective mutable) → futur COMPLETED virtuel → futur
--     loadCboEvolutions. Ce lot s'arrête à la persistance append-only.
--   - Réversibilité : si une politique/topologie ultérieure infirme une attribution, une NOUVELLE
--     résolution est ajoutée ; l'ancienne est CONSERVÉE (audit). La décision courante se dérive.
--
-- Réserve mono-corpus : la validation V2 porte sur RUS seulement. Les métadonnées
-- (policy_version, resolver_source, model) permettront plus tard une gouvernance de validation
-- par corpus/type de document — non construite ici.

-- ── 1. Résolution : une exécution/version de jugement sur une preuve ───────────
CREATE TABLE public.document_completion_resolution (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,

  -- Preuve source IMMUABLE : l'occurrence knowledge_fact resolved (FK canonique).
  proof_occurrence_id   UUID NOT NULL REFERENCES public.canonical_subject_occurrence(id) ON DELETE CASCADE,

  -- Version de politique (resolver + prompt + scoring). Permet le versionnement des décisions.
  policy_version        TEXT NOT NULL,

  -- Empreinte CANONIQUE et DÉTERMINISTE de l'ensemble des CBO candidats évalués (ordre-invariante).
  -- Deux ensembles logiquement identiques (ordre SQL différent) DOIVENT produire la même valeur.
  context_fingerprint   TEXT NOT NULL,

  decision              TEXT NOT NULL CHECK (decision IN ('MATCH', 'AMBIGUOUS', 'NO_MATCH')),
  confidence_class      TEXT NOT NULL CHECK (confidence_class IN ('HIGH', 'MEDIUM', 'LOW')),

  -- CBO retenu — uniquement si decision=MATCH (contrainte de cohérence ci-dessous).
  selected_cbo_id       UUID REFERENCES public.canonical_business_object(id) ON DELETE SET NULL,

  reasoning             TEXT,

  -- Auditabilité / gouvernance future : qui a décidé, avec quel modèle.
  resolver_source       TEXT NOT NULL DEFAULT 'llm' CHECK (resolver_source IN ('llm', 'deterministic', 'manual')),
  model                 TEXT,
  model_version         TEXT,

  resolved_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- selected_cbo_id renseigné SI ET SEULEMENT SI decision=MATCH (jamais un DONE sans cible,
  -- jamais une cible sur AMBIGUOUS/NO_MATCH).
  CONSTRAINT dcr_selected_only_if_match CHECK (
    (decision = 'MATCH'  AND selected_cbo_id IS NOT NULL) OR
    (decision <> 'MATCH' AND selected_cbo_id IS NULL)
  )
);

-- Idempotence : une résolution logique par (preuve, politique, contexte). Un retry/replay du même
-- pipeline ne duplique jamais ; une nouvelle politique OU un nouveau contexte (topologie CBO
-- modifiée par un import rétroactif) produisent une NOUVELLE ligne, l'ancienne restant conservée.
CREATE UNIQUE INDEX dcr_identity_uniq
  ON public.document_completion_resolution (proof_occurrence_id, policy_version, context_fingerprint);

CREATE INDEX dcr_proof_idx  ON public.document_completion_resolution (proof_occurrence_id);
CREATE INDEX dcr_cbo_idx    ON public.document_completion_resolution (selected_cbo_id) WHERE selected_cbo_id IS NOT NULL;
CREATE INDEX dcr_site_idx   ON public.document_completion_resolution (site_id);

-- ── 2. Candidat : ce que la résolution a évalué (audit + calibration structurée) ──
-- Table enfant plutôt que JSONB : on voudra requêter « combien de fois ce CBO a été candidat »,
-- « quelles raisons font échouer HIGH », « décisions changées entre policies » — relationnel.
CREATE TABLE public.document_completion_candidate (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resolution_id                 UUID NOT NULL REFERENCES public.document_completion_resolution(id) ON DELETE CASCADE,
  canonical_business_object_id  UUID NOT NULL REFERENCES public.canonical_business_object(id) ON DELETE CASCADE,

  -- Vocabulaire du resolver V2.
  candidate_verdict             TEXT NOT NULL CHECK (candidate_verdict IN ('accomplished', 'not_accomplished', 'uncertain')),
  intent_match                  TEXT NOT NULL CHECK (intent_match IN ('exact', 'related', 'different')),
  reason                        TEXT,

  CONSTRAINT dcc_unique_per_resolution UNIQUE (resolution_id, canonical_business_object_id)
);

CREATE INDEX dcc_cbo_idx ON public.document_completion_candidate (canonical_business_object_id);
