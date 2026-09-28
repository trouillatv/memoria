-- ============================================================
-- 446 — DOC-CONTRACT-OS-1B1 : correctifs de fermeture (revue Vincent
-- 2026-09-28, relayant une revue ChatGPT du SHA d35d768b).
-- ============================================================
-- Migration 445 déjà appliquée live et poussée — jamais éditée en place.
-- CREATE OR REPLACE FUNCTION patche uniquement le corps de la RPC ; aucun
-- changement de schéma (table/contraintes inchangées).
--
-- Défaut 1 (bloquant) : scope_key était lu depuis contract_effect.scope, un
-- champ humain libre (« Zone Z2, sanitaires » dans ProposalCard) — un vrai
-- MODIFY avec un scope réel aurait toujours violé le CHECK de format. La
-- qualification (review-actions.ts, ProposalCard.tsx) distingue désormais
-- scope (texte libre, jamais lu ici) et scopeKey (portée canonique). La RPC
-- lit exclusivement contract_effect.scopeKey.
--
-- Défaut 2 : un effet NEW/MODIFY permanent pouvait n'avoir aucun ancrage
-- temporel (starts_on NULL accepté). applied_at (horodatage de manipulation)
-- ne doit jamais servir de date contractuelle. Repli sur documents.effective_date
-- si startsOn n'a pas été qualifié explicitement ; refus propre si ni l'un ni
-- l'autre n'existe. SUSPEND garde son exigence stricte de startsOn explicite
-- (déjà en place, inchangée). CONFIRM ne mute rien, aucun ancrage nouveau.
--
-- Défaut 3 traité séparément côté application (setContractEffectAction refuse
-- toute modification de contract_effect quand review_status='materialized') —
-- aucun changement RPC nécessaire pour ce point.

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
  v_document_effective_date date;
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
  -- scope_key vient exclusivement de contract_effect.scopeKey (portée
  -- canonique) — jamais de contract_effect.scope (texte libre humain,
  -- fix défaut 1, revue Vincent 2026-09-28).
  v_effect      := rec.source_payload -> 'contract_effect' ->> 'effect';
  v_temporality := rec.source_payload -> 'contract_effect' ->> 'temporality';
  v_scope_key   := NULLIF(rec.source_payload -> 'contract_effect' ->> 'scopeKey', '');
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

  -- Fix défaut 2 (revue Vincent 2026-09-28) : NEW/MODIFY exigent un ancrage
  -- temporel contractuel — jamais applied_at (horodatage de manipulation).
  -- startsOn qualifié explicitement prime ; à défaut, repli sur
  -- documents.effective_date (date du document source) ; sans les deux,
  -- refus propre plutôt qu'un effet sans date. SUSPEND garde son exigence
  -- stricte de startsOn explicite (vérifiée plus haut, sans repli). CONFIRM
  -- ne mute rien : aucun ancrage nouveau requis.
  IF v_effect IN ('new', 'modify') AND v_starts_on IS NULL THEN
    SELECT effective_date INTO v_document_effective_date FROM public.documents WHERE id = rec.document_id;
    v_starts_on := v_document_effective_date;
  END IF;
  IF v_effect IN ('new', 'modify') AND v_starts_on IS NULL THEN
    RAISE EXCEPTION 'Proposition % : effet % exige un ancrage temporel (startsOn qualifié ou documents.effective_date)', p_proposal_id, v_effect;
  END IF;

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
  'DOC-CONTRACT-OS-1B1 (fix 446) : matérialisation atomique NEW/MODIFY/SUSPEND/CONFIRM. scope_key lu depuis contract_effect.scopeKey (jamais .scope, texte libre humain). NEW/MODIFY exigent startsOn ou documents.effective_date comme ancrage temporel (jamais applied_at). Qualification relue depuis document_extraction_proposal.source_payload.contract_effect. CONFLICT/NON_ENGAGEMENT/non qualifié refusés sans écriture. Idempotente.';
