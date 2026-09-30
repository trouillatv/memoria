-- ============================================================
-- 449 — DOC-CONTRACT-OS-1B4-C1 : modèle de décision d'application Planning
-- (GO Vincent 2026-09-30, sur audit 1B4-A/B0/B FINAL CLOSED, SHA c6864e85).
-- ============================================================
-- Portée strictement C1 : PERSISTE la décision humaine d'appliquer une
-- Planning Impact Proposal (448) à une cible Planning précise, PLUS les
-- empreintes de fraîcheur nécessaires à détecter un décalage AVANT toute
-- écriture réelle. AUCUNE mutation Planning ici (aucun insert/update dans
-- missions, intervention_templates, planning_cycles, planning_cycle_slots ou
-- interventions). L'application réelle (C2+) est un lot séparé, HOLD.
--
-- Corrections d'architecture actées avant ce lot (revue ChatGPT relayée par
-- Vincent, GO_1B4_C1) :
--   1. Table DÉDIÉE et séparée de 448 — jamais une extension de
--      engagement_planning_impact_proposals ni une colonne polymorphe.
--   2. Cibles Planning en colonnes typées explicites (target_mission_id /
--      target_template_id / target_cycle_id), jamais une FK générique
--      (resource_type + resource_id).
--   3. Cycle de vie SANS état `failed` en C1 — draft/ready/applied/cancelled/
--      superseded uniquement ; `applied` est réservé, jamais atteint tant que
--      C2+ n'existe pas.
--   4. Deux axes de péremption INDÉPENDANTS et jamais auto-recalculés en
--      silence : fraîcheur contractuelle (proposal_version_at_decision vs
--      version courante de la proposition 448) et empreinte d'état Planning
--      (planning_state_fingerprint, capturée à la décision, comparée à la
--      relecture — jamais à `updated_at`).
--   + Point gelé supplémentaire (Vincent) : MODIFY sur une source SIMPLE
--     reste BLOQUÉ — aucun chemin d'application en C1, quel que soit l'état
--     de la décision (contrainte CHECK ci-dessous, appliquée en base, pas
--     seulement côté application).
--
-- ── 1. Table planning_impact_application_decisions ───────────────────────
--
-- mutation_kind reprend EXACTEMENT PlanningImpactKind (lib/engagements/
-- planning-impact-proposal.ts) — 'new' | 'modify' | 'suspend' — une décision
-- porte sur UNE proposition 448 déjà qualifiée, jamais un nouveau vocabulaire
-- parallèle.
--
-- target_source_kind distingue, pour modify/suspend UNIQUEMENT, si la cible
-- réelle est un rythme SIMPLE (intervention_templates, cycle_id IS NULL) ou
-- un ROULEMENT (planning_cycles.status='published') — NULL pour 'new' : la
-- cible n'existe pas encore (aucune ligne Planning à typer), seule la Mission
-- d'accueil est connue (target_mission_id).
--
-- target_mission_id est TOUJOURS renseigné (toute mutation cible une
-- Mission). target_template_id / target_cycle_id sont mutuellement exclusifs
-- et déterminés par (mutation_kind, target_source_kind) — cf. CHECK
-- planning_impact_application_decisions_target_shape_check.
CREATE TABLE public.planning_impact_application_decisions (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id                       uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  engagement_id                 uuid NOT NULL REFERENCES public.engagements(id) ON DELETE CASCADE,
  contract_effect_id            uuid NOT NULL REFERENCES public.engagement_contract_effects(id) ON DELETE CASCADE,
  planning_impact_proposal_id   uuid NOT NULL REFERENCES public.engagement_planning_impact_proposals(id) ON DELETE CASCADE,
  proposal_version_at_decision  integer NOT NULL,

  mutation_kind                 text NOT NULL,
  target_mission_id             uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  target_source_kind            text,
  target_template_id            uuid REFERENCES public.intervention_templates(id) ON DELETE CASCADE,
  target_cycle_id               uuid REFERENCES public.planning_cycles(id) ON DELETE CASCADE,

  decision_payload              jsonb NOT NULL DEFAULT '{}'::jsonb,
  application_fingerprint       text NOT NULL,
  -- Empreinte de l'état Planning CIBLE au moment de la décision (grille du
  -- cycle ou champs du rythme simple — jamais updated_at). NULL pour 'new'
  -- (aucune cible existante à empreindre) et pour un modify bloqué (aucun
  -- aperçu appliqué, cf. contrainte de statut ci-dessous).
  planning_state_fingerprint    text,

  status                        text NOT NULL DEFAULT 'draft',
  ready_at                      timestamptz,
  ready_by                      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Réservés à C2+ : jamais renseignés par ce lot (aucun code C1 n'écrit
  -- status='applied').
  applied_at                    timestamptz,
  applied_by                    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at                  timestamptz,
  cancelled_by                  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancellation_reason           text,
  -- Une nouvelle décision draft/ready sur la MÊME proposition supersède
  -- l'ancienne décision non terminale (jamais applied/cancelled) — cf.
  -- lib/db/planning-impact-application-decisions.ts. Auto-référence, jamais
  -- un arbre : une décision n'en supersède qu'une seule, directement.
  supersedes_decision_id        uuid REFERENCES public.planning_impact_application_decisions(id) ON DELETE SET NULL,

  created_by                    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT planning_impact_application_decisions_mutation_kind_check
    CHECK (mutation_kind IN ('new', 'modify', 'suspend')),
  CONSTRAINT planning_impact_application_decisions_target_source_kind_check
    CHECK (target_source_kind IS NULL OR target_source_kind IN ('simple', 'cycle')),
  CONSTRAINT planning_impact_application_decisions_status_check
    CHECK (status IN ('draft', 'ready', 'applied', 'cancelled', 'superseded')),

  -- Forme de la cible déterminée par (mutation_kind, target_source_kind) —
  -- aucune FK générique, chaque cas a exactement une forme valide.
  CONSTRAINT planning_impact_application_decisions_target_shape_check
    CHECK (
      (mutation_kind = 'new' AND target_source_kind IS NULL AND target_template_id IS NULL AND target_cycle_id IS NULL)
      OR
      (mutation_kind IN ('modify', 'suspend') AND target_source_kind = 'simple' AND target_template_id IS NOT NULL AND target_cycle_id IS NULL)
      OR
      (mutation_kind IN ('modify', 'suspend') AND target_source_kind = 'cycle' AND target_cycle_id IS NOT NULL AND target_template_id IS NULL)
    ),

  -- Point gelé Vincent : MODIFY sur une source SIMPLE ne peut JAMAIS devenir
  -- 'ready' (ni, a fortiori, 'applied') — cf.
  -- blocked_requires_simple_supersession, lib/planning/target-resolution.ts.
  -- Contrainte en base, pas seulement une garde applicative.
  CONSTRAINT planning_impact_application_decisions_simple_modify_blocked_check
    CHECK (NOT (mutation_kind = 'modify' AND target_source_kind = 'simple' AND status IN ('ready', 'applied'))),

  -- C1 n'atteint jamais 'applied' — filet de sécurité base, pas une
  -- prédiction sur C2+ (qui pourra lever cette contrainte dans une migration
  -- dédiée quand l'Apply réel sera implémenté).
  CONSTRAINT planning_impact_application_decisions_c1_never_applied_check
    CHECK (status != 'applied'),

  CONSTRAINT planning_impact_application_decisions_ready_consistency_check
    CHECK (
      (status = 'ready' AND ready_at IS NOT NULL AND ready_by IS NOT NULL)
      OR
      (status != 'ready' AND (status NOT IN ('draft') OR (ready_at IS NULL AND ready_by IS NULL)))
    ),
  CONSTRAINT planning_impact_application_decisions_cancelled_consistency_check
    CHECK (
      (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
      OR
      (status != 'cancelled' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
    ),

  -- Invariant d'idempotence (mandat §4) : jamais deux décisions actives avec
  -- le même contenu exact pour le même effet contractuel. Limitation
  -- documentée et acceptée pour C1 : annuler (cancelled) une décision puis
  -- vouloir en recréer une IDENTIQUE (même cible, même payload) est bloqué
  -- par cette contrainte tant que la ligne cancelled existe — un rejeu après
  -- échec d'Apply (C2+) devra faire varier explicitement l'entrée (ex. un sel
  -- de tentative) ou cette contrainte devra être révisée dans la migration
  -- qui introduira l'Apply réel. Pas un problème en C1 : aucune Apply
  -- n'existe encore, donc aucun rejeu n'est requis.
  CONSTRAINT planning_impact_application_decisions_fingerprint_unique
    UNIQUE (contract_effect_id, application_fingerprint)
);

CREATE INDEX planning_impact_application_decisions_engagement_idx
  ON public.planning_impact_application_decisions (engagement_id);
CREATE INDEX planning_impact_application_decisions_contract_effect_idx
  ON public.planning_impact_application_decisions (contract_effect_id);
CREATE INDEX planning_impact_application_decisions_proposal_idx
  ON public.planning_impact_application_decisions (planning_impact_proposal_id);
CREATE INDEX planning_impact_application_decisions_org_idx
  ON public.planning_impact_application_decisions (organization_id);
CREATE INDEX planning_impact_application_decisions_target_mission_idx
  ON public.planning_impact_application_decisions (target_mission_id);

COMMENT ON TABLE public.planning_impact_application_decisions IS
  'DOC-CONTRACT-OS-1B4-C1 : décision humaine d''application d''une Planning Impact Proposal (448) à une cible Planning précise (Mission + rythme SIMPLE ou ROULEMENT), avec empreintes de fraîcheur contractuelle et d''état Planning. AUCUNE mutation Planning, statut jamais applied en C1 — l''Apply réel est C2+, HOLD.';
COMMENT ON COLUMN public.planning_impact_application_decisions.mutation_kind IS
  'Reprend PlanningImpactKind (lib/engagements/planning-impact-proposal.ts) : new | modify | suspend. Jamais un vocabulaire parallèle.';
COMMENT ON COLUMN public.planning_impact_application_decisions.target_source_kind IS
  'NULL pour new (cible pas encore créée). simple | cycle pour modify/suspend selon que le rythme actuel de la Mission est un intervention_templates autonome ou la projection d''un planning_cycles publié.';
COMMENT ON COLUMN public.planning_impact_application_decisions.application_fingerprint IS
  'hash(contract_effect_id + planning_impact_proposal_id + proposal_version_at_decision + mutation_kind + target_mission_id + target_source_kind + target_template_id + target_cycle_id + decision_payload canonisé) — EXCLUT tout champ volatil (id/status/timestamps/decided_by). UNIQUE avec contract_effect_id.';
COMMENT ON COLUMN public.planning_impact_application_decisions.planning_state_fingerprint IS
  'Empreinte déterministe de la grille du cycle (planning_cycles + planning_cycle_slots) ou des champs du rythme simple (intervention_templates) CIBLE, capturée à la décision. Recalculée à la lecture pour détecter un décalage — jamais réappliquée automatiquement (cf. mandat §12).';
COMMENT ON COLUMN public.planning_impact_application_decisions.status IS
  'draft | ready | applied | cancelled | superseded. applied réservé à C2+ (CHECK interdit toute valeur applied en C1). superseded = une décision plus récente sur la même proposition l''a remplacée avant Apply.';

ALTER TABLE public.planning_impact_application_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.planning_impact_application_decisions
  FOR ALL USING (auth.role() = 'service_role');
