-- Migration 389 : identity_status du Point + identity_candidate (Phase 6A)
--
-- GO explicite de Vincent après PASS Phase 5E (trackability/doctrine de fondation,
-- scripts/_p5e-trackability-audit.ts + _p5e-trackability-audit-report.json). Étend
-- mig 388 (Phase 1, schéma minimal, TABLE ENCORE VIDE — aucune écriture n'a jamais
-- eu lieu dans tracked_point/tracked_point_member, cf. commentaire mig 388 § tête).
-- Additive uniquement. Zéro donnée historique écrite par cette migration : elle ne
-- fait qu'ouvrir la place que Phase 6B (réducteur/read-model) et Phase 6C (pilote
-- RUS écrit) rempliront sur GO séparé. Phase 6D (BUILD INITIAL SAFE historique
-- global, 1 446 threads) reste un HARD STOP tant que Vincent n'a pas redonné GO.
--
-- Contrat Founding → Identité → État de Vincent (repris tel quel) :
--   1. FONDATION/TRACKABILITY : CBO → CONFIRMED ; condition suivable sans CBO →
--      PROVISIONAL ; résolution sans problème connu → candidat de rattachement à
--      un Point existant (jamais son propre Point) ; observation indéterminée →
--      PENDING_TRACKABILITY (pas de Point) ; acteur/contexte/temporel seul → aucun
--      Point.
--   2. IDENTITÉ : HARD_MUST_LINK démontré → membership ; lien probable → candidat
--      seulement ; rien démontré → en attente, jamais DISTINCT forcé.
--   3. ÉTAT : réducteur du Point (Phase 2, tracked-point-lifecycle-reducer.ts,
--      INCHANGÉ par cette migration).
--
-- Correction de vocabulaire (Vincent) : ce n'est jamais le POINT qui est "candidat
-- de consolidation" — c'est une TRACE (thread ou sous-ensemble de propositions) qui
-- est candidate à son rattachement à un Point. D'où deux mécanismes distincts et
-- non fusionnés ci-dessous : tracked_point.identity_status (état de confiance du
-- Point lui-même) et tracked_point_identity_candidate (trace en attente d'un
-- arbitrage humain, jamais un statut du Point).

-- ── tracked_point : identity_status + provenance de fondation ─────────────────
--
-- identity_status est ORTHOGONAL à `status` (mig 388 : active/merged/retired, le
-- cycle de vie administratif du Point) et à `computedCurrentState` (Phase 2,
-- réducteur pur, JAMAIS stocké). identity_status répond à une question différente :
-- « à quel point fait-on confiance à l'IDENTITÉ de ce Point ? », pas à son état
-- métier ni à son cycle de vie administratif.
--
-- CONFLICTED est un état d'identité (ex. deux fondations concurrentes non encore
-- arbitrées), distinct du `conflict` que peut produire le réducteur d'ÉTAT (Phase 2)
-- — les deux peuvent coexister ou non, aucune table de vérité commune n'est requise
-- ici puisque Phase 6A ne câble aucun réducteur.

ALTER TABLE public.tracked_point
  ADD COLUMN identity_status TEXT NOT NULL DEFAULT 'PROVISIONAL'
    CHECK (identity_status IN ('CONFIRMED', 'PROVISIONAL', 'CONFLICTED'));

-- founding_kind : le MÉCANISME structurel de fondation (petit ensemble fermé, à
-- étendre uniquement de façon additive si un nouveau mécanisme apparaît — jamais de
-- réaffectation d'une valeur existante). NOT NULL sans défaut : comme `seed_source`
-- (mig 388), force une déclaration explicite à chaque insertion plutôt qu'un
-- mécanisme silencieux par défaut.
--   cbo                 : fondé par un canonical_business_object (identité déjà
--                         arbitrée en amont, P1-4C2A) → doit produire CONFIRMED ou
--                         CONFLICTED, jamais PROVISIONAL (contrainte ci-dessous).
--   trackable_condition : condition suivable sans CBO (Phase 5E, TRACKABLE_CONDITION)
--                         → PROVISIONAL par construction.
--   manual              : création humaine directe (parité avec seed_source).
ALTER TABLE public.tracked_point
  ADD COLUMN founding_kind TEXT
    CHECK (founding_kind IN ('cbo', 'trackable_condition', 'manual'));

ALTER TABLE public.tracked_point
  ALTER COLUMN founding_kind SET NOT NULL;

-- founding_source : étiquette sémantique libre de provenance (ex. 'documentary_
-- trackability' pour les 27 DOCUMENTARY_ACTION_NOT_PROMOTED de Phase 5E Part B —
-- précaution explicite de Vincent : un Point PROVISIONAL né d'une proposition
-- documentaire non promue doit rester distinguable d'une action réellement promue,
-- jamais absorbé silencieusement). Volontairement sans CHECK : le vocabulaire de
-- provenance vivra et s'étendra en Phase 6B/6C au fil des cas réels rencontrés,
-- jamais deviné par avance ici.
ALTER TABLE public.tracked_point
  ADD COLUMN founding_source TEXT;

-- founding_reference : pointeur libre (texte) vers la preuve exacte qui a fondé le
-- Point — id de proposition, de CBO, ou de subject_thread selon founding_kind.
-- Pas de FK typée : la cible varie selon founding_kind (même choix que
-- tracked_point_member.subject_thread_id en mig 388, qui reste un UUID libre sans
-- table dédiée).
ALTER TABLE public.tracked_point
  ADD COLUMN founding_reference TEXT;

-- has_upstream_defect : précaution explicite de Vincent — les 8 units Phase 5E
-- SHOULD_HAVE_CBO_BUT_MISSING (action/deadline qui AURAIT dû avoir un CBO et ne
-- l'a pas) doivent rester repérables comme un défaut CBO amont, jamais dissoutes
-- par la simple existence d'un Point PROVISIONAL qui donnerait l'impression que
-- tout va bien. Bloc, pas un statut : n'affecte ni identity_status ni founding_kind.
ALTER TABLE public.tracked_point
  ADD COLUMN has_upstream_defect BOOLEAN NOT NULL DEFAULT false;

-- Doctrine : une fondation par CBO est par définition une identité déjà arbitrée
-- (P1-4C2A) — jamais un simple PROVISIONAL. Un désaccord y est un CONFLICTED
-- explicite, pas une dégradation silencieuse en PROVISIONAL.
ALTER TABLE public.tracked_point
  ADD CONSTRAINT tracked_point_cbo_founding_confirmed_consistency
    CHECK (founding_kind <> 'cbo' OR identity_status IN ('CONFIRMED', 'CONFLICTED'));

CREATE INDEX ON public.tracked_point (identity_status);
CREATE INDEX ON public.tracked_point (founding_kind);

-- ── tracked_point_member : evidence_grade, HARD uniquement ────────────────────
--
-- Précaution explicite de Vincent : « Pas de SOFT membership déguisée. Les soft
-- links restent des candidats, séparés. » evidence_grade ne porte aujourd'hui
-- qu'une seule valeur légale (HARD) — garde-fou délibéré, pas une colonne
-- prématurée : Phase 4 (moteur READ-ONLY, tracked-point-membership-candidates.ts)
-- produit déjà des décisions SAME_POINT via rail='llm' (Phase 5 dry-run : 296
-- AUTO_REVIEW, cf. POINT-DE-SUIVI-PHASE5-DRYRUN-RAPPORT.md § 8) — celles-ci
-- n'ont JAMAIS le droit de devenir une ligne tracked_point_member tant qu'un
-- humain ne les a pas validées ; elles vivent exclusivement dans
-- tracked_point_identity_candidate (ci-dessous) jusqu'à acceptation. Le jour où un
-- palier SOFT tracé est réellement voulu, cette CHECK s'étend sur nouveau GO —
-- elle ne s'assouplit jamais silencieusement.
ALTER TABLE public.tracked_point_member
  ADD COLUMN evidence_grade TEXT NOT NULL DEFAULT 'HARD'
    CHECK (evidence_grade = 'HARD');

-- ── tracked_point_identity_candidate ───────────────────────────────────────────
--
-- Trace (thread ou sous-ensemble de propositions) candidate à un rattachement à un
-- Point existant — PAS un statut du Point (cf. correction de vocabulaire en tête de
-- fichier). Alimentée par deux sources distinctes, jamais fusionnées à l'écriture :
--   - Phase 4 (moteur membership) quand la décision passe par rail='llm' (SAME_POINT
--     ou UNCERTAIN) — evidence_grade HARD impossible, cf. ci-dessus ;
--   - Phase 5E RESOLUTION_WITHOUT_KNOWN_PROBLEM — une résolution documentaire sans
--     problème connu ne fonde jamais son propre Point ; elle ne devient identité
--     que si un humain confirme qu'elle referme un Point PROVISIONAL/CONFIRMED
--     existant (pattern F8, illustration Vincent : « MemorIA a trouvé une preuve qui
--     pourrait mettre à jour un Point existant. Confirmer le rapprochement ? »).
--
-- Même granularité scope/proposal_ids que tracked_point_member (mig 388) — une
-- trace candidate peut porter sur le thread entier ou un sous-ensemble précis de
-- propositions, jamais sur les propositions sources elles-mêmes (celles-ci ne sont
-- jamais réécrites).
--
-- Append-only en pratique : `status` transitionne pending → accepted|rejected une
-- seule fois (resolved_at daté, jamais de retour à pending). Une acceptation ne
-- matérialise PAS automatiquement de ligne tracked_point_member ici — Phase 6A ne
-- câble aucune écriture automatique ; ce sera un geste explicite de Phase 6C/6D.

CREATE TABLE public.tracked_point_identity_candidate (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            UUID        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  candidate_point_id UUID        NOT NULL REFERENCES public.tracked_point(id) ON DELETE CASCADE,
  subject_thread_id  UUID        NOT NULL,
  scope              TEXT        NOT NULL DEFAULT 'thread'
                        CHECK (scope IN ('thread', 'proposal_set')),
  proposal_ids       UUID[],
  -- Rail d'origine (Phase 4, MembershipRail) quand la trace vient du moteur de
  -- membership ; NULL quand elle vient d'une autre source (ex. Phase 5E
  -- RESOLUTION_WITHOUT_KNOWN_PROBLEM sans passage par le moteur de membership).
  rail               TEXT
                        CHECK (rail IN ('cbo', 'exact', 'strong_containment', 'bounded_cross_subject', 'llm')),
  reason             TEXT        NOT NULL,
  confidence         NUMERIC(4,3),
  evidence           JSONB,
  status             TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'rejected')),
  resolved_at        TIMESTAMPTZ,
  resolved_by        UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- proposal_ids peuplé ⟺ scope='proposal_set' (même garantie que mig 388).
  CONSTRAINT tracked_point_identity_candidate_proposal_set_consistency
    CHECK ((scope = 'proposal_set') = (proposal_ids IS NOT NULL AND array_length(proposal_ids, 1) > 0)),
  -- Une résolution (accepted/rejected) est toujours datée — jamais silencieuse.
  CONSTRAINT tracked_point_identity_candidate_resolved_consistency
    CHECK (status = 'pending' OR resolved_at IS NOT NULL)
);

CREATE INDEX ON public.tracked_point_identity_candidate (candidate_point_id);
CREATE INDEX ON public.tracked_point_identity_candidate (subject_thread_id);
CREATE INDEX ON public.tracked_point_identity_candidate (site_id, status);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Même pattern que mig 388 : lecture org-scopée, écriture réservée au service_role
-- (aucun écrivain applicatif câblé en Phase 6A).

ALTER TABLE public.tracked_point_identity_candidate ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view tracked_point_identity_candidate"
  ON public.tracked_point_identity_candidate FOR SELECT
  USING (
    site_id IN (
      SELECT s.id FROM public.sites s
      JOIN public.organization_memberships om ON om.organization_id = s.organization_id
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
  );

CREATE POLICY "service role manages tracked_point_identity_candidate"
  ON public.tracked_point_identity_candidate FOR ALL
  USING (auth.role() = 'service_role');
