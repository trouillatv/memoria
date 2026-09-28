-- ============================================================
-- 445 — DOC-CONTRACT-OS-1B1 : persistance durable des effets contractuels
-- confirmés (GO Vincent 2026-09-28, sur audit DOC-CONTRACT-OS-1B).
-- ============================================================
-- Portée strictement limitée à 1B1 : schéma + RPC de matérialisation
-- atomique + invariants. AUCUN read-model « applicable à telle date »
-- (1B2), AUCUNE UI historique (1B3), AUCUNE propagation Planning (1B4,
-- GO séparé requis). Table additive, aucune donnée existante touchée.
--
-- OS14 (document réel OCEF Compostage, 7 propositions engagement, 6 sans
-- contract_effect + 1 conflict incohérent) est un témoin délibérément NON
-- réparé — sert de négatif prouvant que ce lot n'invente ni ne matérialise
-- rien sans qualification propre. Ne jamais toucher ce document/run.
--
-- Doctrine (lib/engagements/contract-effect.ts, gelée depuis 1A/1A-UX) :
--   EFFET       = new | modify | suspend | confirm | conflict | non_engagement
--   TEMPORALITÉ = permanent | bounded | one_off | event_driven
-- CONFLICT et NON_ENGAGEMENT bloquent TOUTE matérialisation — ils ne
-- produisent jamais de ligne dans engagement_contract_effects. Seuls
-- NEW/MODIFY/SUSPEND/CONFIRM, qualifiés sans ambiguïté, y aboutissent.

-- ── 1. Table engagement_contract_effects ─────────────────────────────────
--
-- scope_key (ajout Vincent, non proposé initialement) : portée métier
-- canonique déterministe (whole_engagement, frequency, schedule, quantity,
-- access, equipment, reporting…) — pas une ontologie figée (pas de CHECK IN),
-- mais un slug jamais du texte libre, pour que le futur moteur de conflits
-- compare des valeurs déterministes plutôt que du JSON ou du texte IA.
-- Toujours renseigné (défaut 'whole_engagement' si la qualification n'a
-- pas précisé de portée plus fine) ; obligatoire dès la qualification
-- pour MODIFY (invariant vérifié dans la RPC, pas ici).
--
-- effect_payload (jsonb) porte la valeur métier réelle de l'effet (ex.
-- {"frequency": {"from": "2/semaine", "to": "3/semaine"}}) — reste libre,
-- seul scope_key doit être déterministe.
--
-- starts_on/ends_on/resume_on (mandat Vincent) : ne jamais dériver
-- resume_on = ends_on + 1 automatiquement. Une suspension bornée sans
-- resume_on explicite reprend immédiatement après ends_on (aucun trou) ;
-- un resume_on explicite postérieur à ends_on laisse l'intervalle
-- [ends_on+1, resume_on) indéterminé — calculer/qualifier cet état est le
-- périmètre de 1B2, jamais de 1B1.
CREATE TABLE public.engagement_contract_effects (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  engagement_id        uuid NOT NULL REFERENCES public.engagements(id) ON DELETE CASCADE,

  effect               text NOT NULL,
  temporality          text NOT NULL,
  scope_key            text NOT NULL,
  effect_payload       jsonb NOT NULL DEFAULT '{}'::jsonb,

  starts_on            date,
  ends_on              date,
  resume_on            date,

  source_document_id   uuid NOT NULL REFERENCES public.documents(id) ON DELETE NO ACTION,
  source_proposal_id   uuid NOT NULL REFERENCES public.document_extraction_proposal(id) ON DELETE NO ACTION,

  applied_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  applied_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT engagement_contract_effects_effect_check
    CHECK (effect IN ('new', 'modify', 'suspend', 'confirm')),
  CONSTRAINT engagement_contract_effects_temporality_check
    CHECK (temporality IN ('permanent', 'bounded', 'one_off', 'event_driven')),
  CONSTRAINT engagement_contract_effects_scope_key_format_check
    CHECK (scope_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT engagement_contract_effects_bounded_dates_check
    CHECK (temporality <> 'bounded' OR (starts_on IS NOT NULL AND ends_on IS NOT NULL)),
  CONSTRAINT engagement_contract_effects_suspend_starts_check
    CHECK (effect <> 'suspend' OR starts_on IS NOT NULL),
  CONSTRAINT engagement_contract_effects_modify_payload_check
    CHECK (effect <> 'modify' OR effect_payload <> '{}'::jsonb),
  CONSTRAINT engagement_contract_effects_dates_order_check
    CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT engagement_contract_effects_resume_after_end_check
    CHECK (resume_on IS NULL OR ends_on IS NULL OR resume_on > ends_on),

  -- Une proposition qualifiée produit au plus une ligne d'effet confirmé —
  -- même rôle d'idempotence que document_proposal_materialization (436),
  -- vérifié directement sur cette table par la RPC (lecture avant écriture).
  CONSTRAINT engagement_contract_effects_source_proposal_unique UNIQUE (source_proposal_id)
);

CREATE INDEX engagement_contract_effects_engagement_idx
  ON public.engagement_contract_effects (engagement_id, starts_on);
CREATE INDEX engagement_contract_effects_org_idx
  ON public.engagement_contract_effects (organization_id);

COMMENT ON TABLE public.engagement_contract_effects IS
  'DOC-CONTRACT-OS-1B1 : effets contractuels confirmés et applicables (NEW/MODIFY/SUSPEND/CONFIRM uniquement — CONFLICT et NON_ENGAGEMENT ne produisent jamais de ligne ici). Persistance durable au-dessus de engagements, qui reste sans versioning temporel natif.';
COMMENT ON COLUMN public.engagement_contract_effects.scope_key IS
  'Portée métier canonique déterministe (whole_engagement, frequency, schedule, quantity, access, equipment, reporting…) — jamais du texte libre. Obligatoire pour MODIFY (vérifié par la RPC).';
COMMENT ON COLUMN public.engagement_contract_effects.resume_on IS
  'Reprise explicite si différente de ends_on+1 (ex. fenêtre 16/10 ends_on, 19/10 resume_on : le 17-18/10 reste indéterminé, cf. 1B2). NULL = reprise immédiate après ends_on, aucun trou.';

ALTER TABLE public.engagement_contract_effects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.engagement_contract_effects
  FOR ALL USING (auth.role() = 'service_role');

-- ── 2. RPC atomique de matérialisation ────────────────────────────────────
--
-- Une seule fonction pour les 4 effets confirmés : la matérialisation
-- métier (création d'un nouvel Engagement pour NEW ; résolution de la
-- cible existante pour MODIFY/SUSPEND/CONFIRM) et la persistance de son
-- effet contractuel vivent dans LA MÊME transaction (le corps de la
-- fonction). Toute exception après l'INSERT dans engagements fait
-- rollback l'INTÉGRALITÉ de l'appel — jamais un Engagement créé sans son
-- effet, jamais un effet posé sans preuve/évidence.
--
-- La qualification (effet, temporalité, cible, dates, scope) n'est JAMAIS
-- lue depuis un paramètre fourni par l'appelant : elle est relue depuis
-- document_extraction_proposal.source_payload->'contract_effect', seule
-- source de vérité déjà qualifiée par un humain (cf. review-actions.ts,
-- 1A/1A-UX). Élimine toute possibilité de usurper une cible ou un effet
-- au moment de la matérialisation — même discipline que le garde anti-
-- usurpation déjà en place pour CONFIRM dans linkEngagementToProposalAction.
--
-- p_category/p_kind/p_measurable : uniquement utilisés pour NEW, même
-- convention que materialize_engagement_create_new (438) — classification
-- humaine au moment de la matérialisation, jamais déduite de source_payload
-- brut IA. p_effect_payload : valeur métier réelle de MODIFY (ex. nouvelle
-- fréquence) — ignoré et forcé à '{}' pour CONFIRM (zéro mutation garantie
-- même si l'appelant fournit autre chose par erreur).
CREATE OR REPLACE FUNCTION public.materialize_engagement_contract_effect(
  p_proposal_id     uuid,
  p_user_id         uuid,
  p_category        text DEFAULT NULL,
  p_kind            text DEFAULT NULL,
  p_measurable      boolean DEFAULT NULL,
  p_effect_payload  jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(effect_id uuid, engagement_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec                  record;
  v_org_id             uuid;
  v_effect             text;
  v_temporality        text;
  v_scope_key          text;
  v_starts_on          date;
  v_ends_on            date;
  v_resume_on          date;
  v_target_engagement  uuid;
  v_engagement_site_id uuid;
  v_engagement_org_id  uuid;
  v_effect_payload     jsonb;
  v_existing_effect_id uuid;
  v_existing_engagement_id uuid;
BEGIN
  SELECT * INTO rec FROM public.document_extraction_proposal WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposition % introuvable', p_proposal_id;
  END IF;

  IF rec.proposal_family <> 'engagement' THEN
    RAISE EXCEPTION 'Proposition % : famille % invalide (attendu engagement)', p_proposal_id, rec.proposal_family;
  END IF;

  -- Idempotence : rejoue déjà appliqué, jamais une seconde matérialisation.
  -- Alias + colonnes qualifiées obligatoires ici : "engagement_id" est aussi
  -- le nom du second OUT param de RETURNS TABLE, donc une variable PL/pgSQL —
  -- une référence non qualifiée à la colonne est ambiguë (42702).
  SELECT ece.id, ece.engagement_id INTO v_existing_effect_id, v_existing_engagement_id
    FROM public.engagement_contract_effects ece
    WHERE ece.source_proposal_id = p_proposal_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing_effect_id, v_existing_engagement_id;
    RETURN;
  END IF;

  IF rec.review_status NOT IN ('accepted', 'edited') THEN
    RAISE EXCEPTION 'Proposition % : statut % non matérialisable (attendu accepted/edited)', p_proposal_id, rec.review_status;
  END IF;

  IF rec.target_site_id IS NULL THEN
    RAISE EXCEPTION 'Proposition % : aucun chantier cible (target_site_id)', p_proposal_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.document_proposal_evidence WHERE proposal_id = p_proposal_id
  ) THEN
    RAISE EXCEPTION 'Proposition % : aucune preuve (evidence) liée, matérialisation refusée', p_proposal_id;
  END IF;

  IF COALESCE(rec.source_excerpt, '') = '' THEN
    RAISE EXCEPTION 'Proposition % : aucun extrait source (source_excerpt), matérialisation refusée', p_proposal_id;
  END IF;

  IF rec.document_id IS NULL THEN
    RAISE EXCEPTION 'Proposition % : aucun document source (document_id)', p_proposal_id;
  END IF;

  SELECT organization_id INTO v_org_id FROM public.sites WHERE id = rec.target_site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chantier % introuvable', rec.target_site_id;
  END IF;

  -- Qualification EFFET × TEMPORALITÉ relue depuis la seule source de
  -- vérité déjà qualifiée par un humain — jamais un paramètre d'appel.
  v_effect      := rec.source_payload -> 'contract_effect' ->> 'effect';
  v_temporality := rec.source_payload -> 'contract_effect' ->> 'temporality';
  v_scope_key   := NULLIF(rec.source_payload -> 'contract_effect' ->> 'scope', '');
  v_starts_on   := NULLIF(rec.source_payload -> 'contract_effect' ->> 'startsOn', '')::date;
  v_ends_on     := NULLIF(rec.source_payload -> 'contract_effect' ->> 'endsOn', '')::date;
  v_resume_on   := NULLIF(rec.source_payload -> 'contract_effect' ->> 'resumeOn', '')::date;
  v_target_engagement := NULLIF(rec.source_payload -> 'contract_effect' ->> 'targetEngagementId', '')::uuid;

  -- CONFLICT, NON_ENGAGEMENT, ou absence de qualification (OS14 : 6/7 sans
  -- contract_effect, 1/7 conflict) bloquent TOUJOURS la matérialisation —
  -- aucune ligne n'est jamais créée pour ces cas.
  IF v_effect IS NULL OR v_effect NOT IN ('new', 'modify', 'suspend', 'confirm') THEN
    RAISE EXCEPTION 'Proposition % : effet contractuel % non matérialisable (conflict/non_engagement/non qualifié bloquent toute matérialisation)', p_proposal_id, v_effect;
  END IF;

  IF v_temporality IS NULL OR v_temporality NOT IN ('permanent', 'bounded', 'one_off', 'event_driven') THEN
    RAISE EXCEPTION 'Proposition % : temporalité % invalide', p_proposal_id, v_temporality;
  END IF;

  IF v_temporality = 'bounded' AND (v_starts_on IS NULL OR v_ends_on IS NULL) THEN
    RAISE EXCEPTION 'Proposition % : temporalité bornée exige startsOn et endsOn', p_proposal_id;
  END IF;

  IF v_starts_on IS NOT NULL AND v_ends_on IS NOT NULL AND v_ends_on < v_starts_on THEN
    RAISE EXCEPTION 'Proposition % : endsOn (%) antérieur à startsOn (%)', p_proposal_id, v_ends_on, v_starts_on;
  END IF;

  IF v_resume_on IS NOT NULL AND v_ends_on IS NOT NULL AND v_resume_on <= v_ends_on THEN
    RAISE EXCEPTION 'Proposition % : resumeOn (%) doit être postérieur à endsOn (%)', p_proposal_id, v_resume_on, v_ends_on;
  END IF;

  v_effect_payload := COALESCE(p_effect_payload, '{}'::jsonb);

  -- Invariants par type d'effet (mandat Vincent, 1B1).
  IF v_effect IN ('modify', 'suspend', 'confirm') THEN
    IF v_target_engagement IS NULL THEN
      RAISE EXCEPTION 'Proposition % : effet % exige un Engagement cible qualifié', p_proposal_id, v_effect;
    END IF;

    SELECT site_id, organization_id INTO v_engagement_site_id, v_engagement_org_id
      FROM public.engagements WHERE id = v_target_engagement FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Engagement cible % introuvable', v_target_engagement;
    END IF;

    IF v_engagement_site_id IS DISTINCT FROM rec.target_site_id THEN
      RAISE EXCEPTION 'Engagement % appartient au chantier %, attendu % (rattachement cross-site refusé)',
        v_target_engagement, v_engagement_site_id, rec.target_site_id;
    END IF;

    IF v_engagement_org_id IS DISTINCT FROM v_org_id THEN
      RAISE EXCEPTION 'Engagement % organisation % incohérente avec le chantier (org %) — rattachement cross-org refusé',
        v_target_engagement, v_engagement_org_id, v_org_id;
    END IF;
  END IF;

  IF v_effect = 'modify' THEN
    IF v_scope_key IS NULL THEN
      RAISE EXCEPTION 'Proposition % : effet modify exige un scope qualifié (scope_key)', p_proposal_id;
    END IF;
    IF v_effect_payload = '{}'::jsonb THEN
      RAISE EXCEPTION 'Proposition % : effet modify exige un effect_payload non vide', p_proposal_id;
    END IF;
  END IF;

  IF v_effect = 'suspend' AND v_starts_on IS NULL THEN
    RAISE EXCEPTION 'Proposition % : effet suspend exige startsOn', p_proposal_id;
  END IF;

  -- CONFIRM : zéro mutation de la règle métier, quel que soit ce que
  -- l'appelant a fourni — jamais une valeur métier pour un simple rappel.
  IF v_effect = 'confirm' THEN
    v_effect_payload := '{}'::jsonb;
  END IF;

  v_scope_key := COALESCE(v_scope_key, 'whole_engagement');

  IF v_effect = 'new' THEN
    IF p_category IS NULL THEN
      RAISE EXCEPTION 'Proposition % : catégorie (p_category) requise pour un nouvel Engagement', p_proposal_id;
    END IF;
    IF p_kind IS NULL OR p_kind NOT IN ('objectif', 'obligation', 'livrable', 'controle', 'penalite') THEN
      RAISE EXCEPTION 'Proposition % : nature (p_kind) requise et doit être valide, reçu : %', p_proposal_id, p_kind;
    END IF;
    IF p_measurable IS NULL THEN
      RAISE EXCEPTION 'Proposition % : mesurable (p_measurable) requis', p_proposal_id;
    END IF;

    INSERT INTO public.engagements (
      tender_id, contract_id, site_id,
      source_type, source_excerpt, source_document_id, page_number,
      category, kind,
      short_label, measurable, status,
      organization_id, created_by
    ) VALUES (
      NULL, NULL, rec.target_site_id,
      'manual', rec.source_excerpt, rec.document_id, rec.source_page,
      p_category::public.engagement_category,
      p_kind,
      COALESCE(rec.reviewed_label, rec.label),
      p_measurable,
      'curated',
      v_org_id, p_user_id
    ) RETURNING id INTO v_target_engagement;
  END IF;

  INSERT INTO public.engagement_contract_effects (
    organization_id, engagement_id,
    effect, temporality, scope_key, effect_payload,
    starts_on, ends_on, resume_on,
    source_document_id, source_proposal_id,
    applied_by
  ) VALUES (
    v_org_id, v_target_engagement,
    v_effect, v_temporality, v_scope_key, v_effect_payload,
    v_starts_on, v_ends_on, v_resume_on,
    rec.document_id, p_proposal_id,
    p_user_id
  ) RETURNING id INTO v_existing_effect_id;

  INSERT INTO public.document_proposal_materialization (
    organization_id, proposal_id,
    target_entity_type, target_entity_id,
    status, created_by
  ) VALUES (
    v_org_id, p_proposal_id, 'engagement', v_target_engagement, 'done', p_user_id
  ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

  UPDATE public.document_extraction_proposal
    SET review_status = 'materialized'
    WHERE id = p_proposal_id;

  RETURN QUERY SELECT v_existing_effect_id, v_target_engagement;
END;
$$;

COMMENT ON FUNCTION public.materialize_engagement_contract_effect(uuid, uuid, text, text, boolean, jsonb) IS
  'DOC-CONTRACT-OS-1B1 : matérialisation atomique NEW/MODIFY/SUSPEND/CONFIRM. Qualification relue depuis document_extraction_proposal.source_payload.contract_effect (jamais un paramètre d''appel). CONFLICT/NON_ENGAGEMENT/non qualifié refusés sans écriture. Idempotente.';

-- Primitive interne appelée par les Server Actions après gardes M2C —
-- jamais exécutable directement par anon/authenticated (même doctrine que
-- 443/444).
REVOKE EXECUTE ON FUNCTION public.materialize_engagement_contract_effect(uuid, uuid, text, text, boolean, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.materialize_engagement_contract_effect(uuid, uuid, text, text, boolean, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.materialize_engagement_contract_effect(uuid, uuid, text, text, boolean, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_engagement_contract_effect(uuid, uuid, text, text, boolean, jsonb) TO service_role;
