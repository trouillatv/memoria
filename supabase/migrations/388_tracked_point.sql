-- Migration 388 : tracked_point (Point de suivi)
--
-- Identité durable de la chose métier précise dont l'état évolue, indépendamment
-- des autres choses du même sujet. Contrat : P0-1G (Modèle B, Point AU-DESSUS
-- du CBO) + P0-1H (gates 1-4 levées). Phase 1 du programme d'implémentation
-- contrôlée : schéma minimal SEULEMENT. Aucune écriture automatique, aucune
-- création de Point, aucun câblage UI, aucun backfill dans cette migration.
--
-- Symétrique de canonical_subject / canonical_business_object (mig 279 / 302) :
--   canonical_subject    = organise la mémoire ; devient une PROJECTION du Point
--                           ({ nPoints, open, resolved, reopened, unknown, conflict })
--   tracked_point         = identité durable de la chose ; état DÉRIVÉ, jamais stocké
--   tracked_point_member  = adhésion documentaire (thread) ou d'obligation (CBO),
--                           append-only, jamais réécrite ni supprimée
--
-- Volontairement ABSENT de cette table : toute colonne d'état (current_state).
-- L'état du Point est calculé par un réducteur pur (Phase 2, extension directe de
-- reduceCboLifecycle/CboReducedState — P1-4C2A) à partir des membres actifs, jamais
-- une vérité éditable à la main. Le Point ne ré-arbitre jamais l'intérieur d'un CBO :
-- il consomme CboReducedState.computedCurrentState tel quel (Gate 4).

-- ── TABLE : tracked_point ──────────────────────────────────────────────────────

CREATE TABLE public.tracked_point (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              UUID        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  -- Nullable uniquement pendant l'amorçage (même règle que canonical_business_object,
  -- mig 302). Le sujet est une propriété POSSÉDÉE choisie par règle déterministe
  -- (CBO fondateur > membre le plus spécifique), jamais une frontière de matching
  -- (Gate 1) — donc jamais NOT NULL a priori, jamais réécrit automatiquement.
  canonical_subject_id UUID        REFERENCES public.canonical_subject(id) ON DELETE SET NULL,
  -- Label humain nommant la CHOSE (pas l'action, pas l'énoncé) ; renommable sans
  -- perte d'identité (l'id ne change jamais).
  label                TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'merged', 'retired')),
  merged_into_id       UUID        REFERENCES public.tracked_point(id) ON DELETE RESTRICT,
  -- Provenance de création/amorçage (§9 P0-1G) : d'où vient ce Point la première fois.
  seed_source          TEXT        NOT NULL
                          CHECK (seed_source IN ('cbo_seed', 'thread_seed', 'llm_join', 'manual')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- merged_into_id renseigné ⟺ status = 'merged' (jamais l'un sans l'autre).
  CONSTRAINT tracked_point_merged_consistency
    CHECK ((status = 'merged') = (merged_into_id IS NOT NULL))
);

CREATE INDEX ON public.tracked_point (site_id);
CREATE INDEX ON public.tracked_point (canonical_subject_id);
CREATE INDEX ON public.tracked_point (site_id, status);

-- ── TABLE : tracked_point_member ───────────────────────────────────────────────
--
-- Adhésion documentaire d'un thread au Point. Append-only : une ligne n'est
-- jamais supprimée ni réécrite, seulement retirée (status='retired', avec date et
-- raison) — Gate 3. Brique atomique = le thread ENTIER (scope='thread', défaut).
-- scope='proposal_set' est l'exception de correction d'un drift sémantique : un
-- sous-ensemble précis de propositions du thread rattaché à un AUTRE Point que le
-- reste du thread, sans jamais modifier le thread / subject_thread_identity / les
-- propositions sources eux-mêmes — la correction vit entièrement côté Point.
--
-- subject_thread_id : UUID libre, sans table dédiée (même convention que
-- subject_thread_identity.subject_thread_id, mig 279 — le moteur lexical n'a
-- jamais matérialisé de table `subject_thread`).

CREATE TABLE public.tracked_point_member (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tracked_point_id  UUID        NOT NULL REFERENCES public.tracked_point(id) ON DELETE CASCADE,
  subject_thread_id UUID        NOT NULL,
  scope             TEXT        NOT NULL DEFAULT 'thread'
                       CHECK (scope IN ('thread', 'proposal_set')),
  -- Peuplé seulement quand scope='proposal_set' : le sous-ensemble de propositions
  -- du thread couvert par CETTE ligne de membership (la correction de drift, Gate 3).
  proposal_ids      UUID[],
  status            TEXT        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'retired')),
  -- Pattern mig 302 (canonical_business_object_member) : source du rattachement.
  resolution_source TEXT        NOT NULL DEFAULT 'manual'
                       CHECK (resolution_source IN ('manual', 'deterministic', 'llm')),
  llm_confidence    NUMERIC(4,3),
  llm_reasoning     TEXT,
  -- Gate 1 : le membre vient d'un canonical_subject différent du sujet propriétaire
  -- du Point (voisinage de candidature élargi aux orphelins et sujets apparentés).
  -- Jamais une réécriture de subject_thread_identity — seulement une preuve auditable
  -- alimentant une future file de correction de granularité des sujets.
  subject_mismatch  BOOLEAN     NOT NULL DEFAULT false,
  retired_at        TIMESTAMPTZ,
  retired_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- proposal_ids peuplé ⟺ scope='proposal_set' (jamais l'un sans l'autre).
  CONSTRAINT tracked_point_member_proposal_set_consistency
    CHECK ((scope = 'proposal_set') = (proposal_ids IS NOT NULL AND array_length(proposal_ids, 1) > 0)),
  -- Un retrait est daté (jamais 'retired' silencieux).
  CONSTRAINT tracked_point_member_retired_consistency
    CHECK (status = 'active' OR retired_at IS NOT NULL)
);

-- Un thread est membre ACTIF d'au plus un Point en scope='thread' (Gate 3, garantie
-- de schéma n°1). scope='proposal_set' est volontairement HORS de cet index : c'est
-- exactement le mécanisme qui permet à des lignes proposal_set du MÊME thread de
-- pointer vers des Points distincts pendant une correction de drift.
CREATE UNIQUE INDEX tracked_point_member_active_thread_uidx
  ON public.tracked_point_member (subject_thread_id)
  WHERE status = 'active' AND scope = 'thread';

CREATE INDEX ON public.tracked_point_member (tracked_point_id);
CREATE INDEX ON public.tracked_point_member (subject_thread_id);

-- ── Relation Point ↔ CBO : un CBO appartient à ≤ 1 Point (0..n dans l'autre sens) ──
--
-- Additive, nullable. Le contrat CBO existant (mig 302, réducteur P1-4C2A, pont
-- P1-4B, surfaces Actions/Attention) reste À L'IDENTIQUE pour tout consommateur qui
-- ignore cette colonne — rien de la chaîne P1 gelée n'est touché (Modèle B, P0-1G §1).
-- La cardinalité Point 0..n CBO / CBO ≤1 Point place naturellement la FK côté CBO.

ALTER TABLE public.canonical_business_object
  ADD COLUMN tracked_point_id UUID REFERENCES public.tracked_point(id) ON DELETE SET NULL;

CREATE INDEX ON public.canonical_business_object (tracked_point_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.tracked_point        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracked_point_member ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view tracked_point"
  ON public.tracked_point FOR SELECT
  USING (
    site_id IN (
      SELECT s.id FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "org members can view tracked_point_member"
  ON public.tracked_point_member FOR SELECT
  USING (
    tracked_point_id IN (
      SELECT tp.id FROM public.tracked_point tp
      JOIN public.sites s ON s.id = tp.site_id
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

-- Écriture réservée au service_role (résolution via scripts/API interne — pattern
-- mig 302). Aucun écrivain applicatif dans cette migration : Phase 4 (membership)
-- reste READ-ONLY, Phase 5 (amorçage) reste dry-run. La première écriture réelle
-- est un lot séparé avec GO distinct de Vincent.
CREATE POLICY "service role manages tracked_point"
  ON public.tracked_point FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service role manages tracked_point_member"
  ON public.tracked_point_member FOR ALL
  USING (auth.role() = 'service_role');
