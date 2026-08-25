-- Migration 349 : object_state_occurrence_signal
--
-- P1-C2B.4 H2-B.1 — schéma de persistance UNIQUEMENT. Pas de branchement live,
-- pas d'appel Gemini, pas de backfill, pas de calcul longitudinal UI dans ce lot
-- (mandat Vincent, HARD STOP après migration + tests).
--
-- Contexte : H2-A a validé conceptuellement une architecture à 2 passes IA
-- (observation locale bornée à une occurrence + interprétation longitudinale
-- bornée au CBO) + un garde-fou déterministe (jamais REOPENED sans COMPLETED
-- antérieur réel). Cette table persiste UNE ligne par occurrence d'objet métier
-- (site_action/site_reserve/site_deadline), adressée comme
-- canonical_business_object_member (entity_type, entity_id) — pas via
-- document_extraction_proposal, car les occurrences créées en terrain (CR
-- mobile) n'ont aucune proposition associée.
--
-- Doctrine transverse : le LLM ne possède jamais l'état du CBO. Cette table ne
-- stocke qu'une observation locale par occurrence ; la trajectoire du CBO reste
-- une fonction pure, recalculée à la demande à partir de ces lignes (jamais un
-- champ mutable "statut courant" écrasé au fil de l'eau).
--
-- Diagnostic de panne LLM (ajouté au mandat H2-B) : une ligne 'unresolved' ne
-- doit jamais dire seulement "l'IA n'a pas répondu" — elle porte une cause
-- technique typée (error_code) pour rester diagnosticable à distance. Trois
-- résultats jamais confondus :
--   resolved + NO_STATE_SIGNAL   = l'IA a fonctionné, conclut qu'il n'y a pas
--                                   de changement d'état (vraie conclusion sémantique)
--   resolved + autre signal      = l'IA a fonctionné, produit une observation
--   unresolved + error_code      = échec technique, aucune conclusion sémantique
-- Une panne LLM ne devient jamais un état métier et n'infléchit jamais la
-- trajectoire du CBO (une ligne unresolved est exclue du calcul longitudinal).

-- ── Table principale ──────────────────────────────────────────────────────────

CREATE TABLE public.object_state_occurrence_signal (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Adressage de l'occurrence — symétrique à canonical_business_object_member
  -- (member_entity_type, member_entity_id), volontairement PAS via
  -- document_extraction_proposal (les occurrences terrain n'en ont pas).
  entity_type                   TEXT NOT NULL
    CHECK (entity_type IN ('site_reserve', 'site_action', 'site_deadline')),
  entity_id                     UUID NOT NULL,
  site_id                       UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,

  -- Rattachement CBO — nullable tant que l'occurrence n'est pas (encore)
  -- rattachée ; resynchronisé automatiquement si le membership change
  -- (cf. trigger plus bas).
  canonical_business_object_id  UUID REFERENCES public.canonical_business_object(id) ON DELETE SET NULL,

  -- Résultat global : soit une conclusion sémantique (resolved), soit un échec
  -- technique diagnostiqué (unresolved) — jamais les deux, jamais ni l'un ni
  -- l'autre (cf. contrainte plus bas).
  status                        TEXT NOT NULL
    CHECK (status IN ('resolved', 'unresolved')),

  -- Provenance de la décision : mapping déterministe (ex. document_status=done)
  -- ou pipeline IA à 2 passes.
  source                        TEXT NOT NULL
    CHECK (source IN ('document_status', 'llm')),

  -- Étape 1 — IA locale stateless (ce que l'occurrence affirme intrinsèquement)
  step1_signal                  TEXT
    CHECK (step1_signal IN ('OPENED', 'STILL_OPEN', 'PROGRESS', 'COMPLETED', 'REOPENED', 'NO_STATE_SIGNAL')),
  step1_reasoning               TEXT,

  -- Étape 2 — IA longitudinale bornée au CBO
  step2_signal                  TEXT
    CHECK (step2_signal IN ('OPENED', 'STILL_OPEN', 'PROGRESS', 'COMPLETED', 'REOPENED', 'NO_STATE_SIGNAL')),
  step2_reasoning               TEXT,

  -- Étape 3 — résultat après garde-fou déterministe (ce que le calcul
  -- longitudinal du CBO doit lire)
  final_signal                  TEXT
    CHECK (final_signal IN ('OPENED', 'STILL_OPEN', 'PROGRESS', 'COMPLETED', 'REOPENED', 'NO_STATE_SIGNAL')),
  backstop_applied               BOOLEAN NOT NULL DEFAULT false,
  backstop_reason                TEXT,

  -- Modèle et confiance
  model                         TEXT,
  model_version                 TEXT,
  confidence                    NUMERIC(4,3),

  -- Date métier de l'occurrence (effective_date du document source, ou date de
  -- la visite terrain) — clé de tri pour le rejeu chronologique de la trajectoire.
  occurrence_date                DATE,

  -- ── Diagnostic de panne LLM (H2-B, mandat Vincent 2026-08-25) ────────────────
  error_code                    TEXT
    CHECK (error_code IN (
      'NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'PROVIDER_ERROR',
      'INVALID_RESPONSE', 'SCHEMA_VALIDATION_ERROR', 'EMPTY_RESPONSE',
      'CONFIG_ERROR', 'UNKNOWN_ERROR'
    )),
  error_detail                  TEXT
    CHECK (error_detail IS NULL OR char_length(error_detail) <= 500),
  attempt_count                 INT NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  last_attempt_at                TIMESTAMPTZ,
  provider_request_id            TEXT,

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotence : une occurrence ne peut avoir qu'une seule ligne de signal
  -- (même pattern que canonical_business_object_member, mig 302).
  UNIQUE (entity_type, entity_id),

  -- Séparation stricte sémantique/technique : une ligne resolved porte une
  -- conclusion et pas d'erreur ; une ligne unresolved porte une erreur et pas
  -- de conclusion. NO_STATE_SIGNAL est une conclusion valide (source='llm' a
  -- fonctionné), pas un défaut silencieux de panne.
  CONSTRAINT resolved_xor_unresolved CHECK (
    (status = 'resolved'   AND final_signal IS NOT NULL AND error_code IS NULL AND error_detail IS NULL)
    OR
    (status = 'unresolved' AND final_signal IS NULL     AND error_code IS NOT NULL)
  )
);

CREATE INDEX ON public.object_state_occurrence_signal (canonical_business_object_id, occurrence_date);
CREATE INDEX ON public.object_state_occurrence_signal (site_id);
CREATE INDEX ON public.object_state_occurrence_signal (status) WHERE status = 'unresolved';

COMMENT ON TABLE public.object_state_occurrence_signal IS
  'H2-B — une ligne par occurrence d''objet métier (site_action/site_reserve/site_deadline). '
  'Observation locale, jamais l''état du CBO lui-même : la trajectoire du CBO est recalculée '
  'à la demande à partir de ces lignes. unresolved = échec technique diagnostiqué (error_code), '
  'jamais confondu avec resolved+NO_STATE_SIGNAL (vraie conclusion sémantique).';

-- ── Trigger updated_at ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_object_state_occurrence_signal_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_object_state_occurrence_signal_updated_at
  BEFORE UPDATE ON public.object_state_occurrence_signal
  FOR EACH ROW
  EXECUTE FUNCTION public.set_object_state_occurrence_signal_updated_at();

-- ── Trigger de reroutage si le membership CBO change ─────────────────────────
--
-- Aujourd'hui, canonical_business_object_member.canonical_business_object_id
-- n'est réassigné que par un script ponctuel de consolidation (voir
-- scripts/p1c2b4d-phase-b-execute.ts, UPDATE direct lors d'une fusion manuelle
-- de deux CBO). Rien ne garantit qu'un futur mécanisme (fusion CBO outillée,
-- script de correction) pensera à resynchroniser cette table. On installe donc
-- l'invariant en base plutôt que de compter sur la discipline applicative —
-- même doctrine que les contraintes UNIQUE déjà en place sur ce chantier.

CREATE OR REPLACE FUNCTION public.sync_object_state_occurrence_signal_cbo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.object_state_occurrence_signal
  SET canonical_business_object_id = NEW.canonical_business_object_id
  WHERE entity_type = NEW.member_entity_type
    AND entity_id = NEW.member_entity_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_occurrence_signal_cbo
  AFTER UPDATE OF canonical_business_object_id ON public.canonical_business_object_member
  FOR EACH ROW
  WHEN (OLD.canonical_business_object_id IS DISTINCT FROM NEW.canonical_business_object_id)
  EXECUTE FUNCTION public.sync_object_state_occurrence_signal_cbo();

COMMENT ON FUNCTION public.sync_object_state_occurrence_signal_cbo() IS
  'H2-B — resynchronise object_state_occurrence_signal.canonical_business_object_id '
  'quand canonical_business_object_member.canonical_business_object_id change (ex. '
  'consolidation manuelle de deux CBO). Évite qu''un signal reste rattaché à un CBO périmé.';

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.object_state_occurrence_signal ENABLE ROW LEVEL SECURITY;

-- Même pattern que canonical_business_object : visibilité héritée via
-- sites.organization_id, directement sur site_id (pas besoin de passer par le
-- CBO, qui peut être null tant que l'occurrence n'est pas rattachée).
CREATE POLICY "org members can view object_state_occurrence_signal"
  ON public.object_state_occurrence_signal FOR SELECT
  USING (
    site_id IN (
      SELECT s.id FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

-- Écriture réservée au service_role (calcul via pipeline interne, jamais côté client)
CREATE POLICY "service role manages object_state_occurrence_signal"
  ON public.object_state_occurrence_signal FOR ALL
  USING (auth.role() = 'service_role');
