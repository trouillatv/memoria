-- ============================================================
-- 448 — DOC-CONTRACT-OS-1B4-B : Planning Impact Proposals (GO Vincent
-- 2026-09-30, sur audit DOC-CONTRACT-OS-1B4-A FINAL CLOSED).
-- ============================================================
-- Portée strictement limitée à 1B4-B : persistance de la PROPOSITION
-- d'impact Planning interprétée depuis un effet contractuel confirmé, et de
-- la DÉCISION HUMAINE de revue sur cette proposition. AUCUNE mutation
-- Planning (aucun insert/update dans missions, site_planning_items,
-- planning_cycles ou toute autre table du domaine Planning). L'application
-- réelle dans le Planning est 1B4-C, HOLD, non implémentée ici.
--
-- Doctrine gelée par le mandat 1B4-B (Vincent, réponse à l'AskUserQuestion
-- persistance vs calcul) :
--   « effet contractuel → proposition déterministe calculable → état de
--     revue persisté » — jamais un gros objet Planning figé en base.
--
-- Ce qui est PERSISTÉ (cette table) : l'impact contractuel interprété
-- (proposal_payload, dérivé uniquement de engagement_contract_effects — sans
-- aucune donnée Planning : jamais de jour/heure/équipe/planning_cycle_id/
-- occurrence) + la décision humaine de revue (status/dismissed_*).
--
-- Ce qui est CALCULÉ à la volée, jamais persisté (lib/engagements/
-- planning-impact-proposal.ts, resolvePlanningApplicationCapability) : la
-- capacité d'application dans le Planning actuel et les décisions humaines
-- manquantes. Persister ce calcul créerait une vérité périmée si le
-- Planning évolue plus tard (ex. un futur mécanisme natif de suspension
-- rendrait blockingReason='no_native_suspend_resume' faux sans qu'aucune
-- ligne ici n'ait changé).
--
-- Cycle de vie 1B4-B UNIQUEMENT : proposed | dismissed. Pas de accepted/
-- applied/partially_applied/failed — ceux-là appartiennent à 1B4-C (HOLD),
-- volontairement non pré-conçus ici.

-- ── 1. Table engagement_planning_impact_proposals ────────────────────────
--
-- site_id dénormalisé depuis engagements.site_id au moment de la génération
-- (nullable, comme sa source — cf. lib/engagements/resolve-contract-state-
-- for-user.ts qui traite déjà site_id comme optionnel) : lecture directe par
-- chantier sans jointure, jamais une source de vérité alternative.
--
-- impact_kind reprend exactement le sous-ensemble matérialisable de l'effet
-- contractuel (new/modify/suspend) — CONFIRM ne produit jamais de ligne ici
-- (doctrine 8, resolve-contract-state.ts : CONFIRM est de la provenance
-- pure, jamais un impact Planning).
--
-- proposal_fingerprint identifie le CONTENU exact d'une version de
-- proposition (contract_effect_id + impact_kind + proposal_payload canonisé
-- + proposal_version) — UNIQUE, jamais un UNIQUE(contract_effect_id) : un
-- futur effet pourrait produire plusieurs impacts Planning distincts (ex.
-- deux missions), et une proposition peut être régénérée en nouvelle version
-- si son contenu dérivé change (ex. valeur "from" recalculée après insertion
-- d'un effet antérieur). Toujours le service de génération qui décide de la
-- version, jamais un appelant.
CREATE TABLE public.engagement_planning_impact_proposals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id               uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES public.engagements(id) ON DELETE CASCADE,
  contract_effect_id    uuid NOT NULL REFERENCES public.engagement_contract_effects(id) ON DELETE CASCADE,

  impact_kind           text NOT NULL,
  proposal_payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposal_fingerprint  text NOT NULL,
  proposal_version      integer NOT NULL DEFAULT 1,

  status                text NOT NULL DEFAULT 'proposed',
  dismissed_at          timestamptz,
  dismissed_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  dismissal_reason      text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT engagement_planning_impact_proposals_impact_kind_check
    CHECK (impact_kind IN ('new', 'modify', 'suspend')),
  CONSTRAINT engagement_planning_impact_proposals_status_check
    CHECK (status IN ('proposed', 'dismissed')),
  CONSTRAINT engagement_planning_impact_proposals_version_positive_check
    CHECK (proposal_version > 0),
  CONSTRAINT engagement_planning_impact_proposals_dismissed_consistency_check
    CHECK (
      (status = 'dismissed' AND dismissed_at IS NOT NULL AND dismissed_by IS NOT NULL)
      OR
      (status = 'proposed' AND dismissed_at IS NULL AND dismissed_by IS NULL AND dismissal_reason IS NULL)
    ),
  CONSTRAINT engagement_planning_impact_proposals_fingerprint_unique
    UNIQUE (proposal_fingerprint)
);

CREATE INDEX engagement_planning_impact_proposals_engagement_idx
  ON public.engagement_planning_impact_proposals (engagement_id);
CREATE INDEX engagement_planning_impact_proposals_contract_effect_idx
  ON public.engagement_planning_impact_proposals (contract_effect_id);
CREATE INDEX engagement_planning_impact_proposals_org_idx
  ON public.engagement_planning_impact_proposals (organization_id);

COMMENT ON TABLE public.engagement_planning_impact_proposals IS
  'DOC-CONTRACT-OS-1B4-B : proposition Planning déterministe dérivée d''un engagement_contract_effect (NEW/MODIFY/SUSPEND) + décision humaine de revue (proposed/dismissed uniquement). AUCUNE mutation Planning, AUCUN champ Planning (jour/heure/équipe/occurrence) — 1B4-C (application) est un lot séparé, HOLD.';
COMMENT ON COLUMN public.engagement_planning_impact_proposals.proposal_payload IS
  'Impact contractuel interprété UNIQUEMENT (ex. {"operation":"change_frequency","scopeKey":"frequency","effectiveFrom":"2026-12-01","from":{...},"to":{...}} ou {"operation":"suspend","effectiveFrom":...,"effectiveTo":...,"resumeOn":...}) — jamais de donnée Planning/application.';
COMMENT ON COLUMN public.engagement_planning_impact_proposals.proposal_fingerprint IS
  'hash(contract_effect_id + impact_kind + proposal_payload canonisé + proposal_version) — idempotence de génération. UNIQUE, jamais UNIQUE(contract_effect_id) : un effet peut produire plusieurs impacts, une proposition peut être régénérée en nouvelle version.';
COMMENT ON COLUMN public.engagement_planning_impact_proposals.status IS
  '1B4-B : proposed | dismissed uniquement. accepted/applied/partially_applied/failed appartiennent à 1B4-C (HOLD), non modélisés ici.';

ALTER TABLE public.engagement_planning_impact_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.engagement_planning_impact_proposals
  FOR ALL USING (auth.role() = 'service_role');
