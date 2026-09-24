-- P0-2C FIX_REQUIRED (mandat Vincent 2026-09-24, revue SHA e88034a1) — problème 2.
-- N'édite JAMAIS 436/437 (déjà appliquées en live) : additive uniquement.
--
-- materialize_engagement_create_new lisait kind/measurable depuis
-- rec.source_payload (brut IA), jamais depuis un paramètre explicite. Une
-- correction humaine faite côté UI (ProposalCard) était donc écrite dans
-- source_payload par review-actions.ts AVANT l'appel RPC — et cette écriture
-- s'exécutait même si la proposition était encore pending/rejected, c'est-à-
-- dire AVANT que la RPC ne vérifie review_status IN ('accepted','edited').
-- Résultat : une proposition non matérialisable pouvait quand même voir son
-- source_payload muté par un geste de « création » refusé ensuite.
--
-- Correctif : p_kind et p_measurable deviennent des paramètres obligatoires
-- (aucun défaut), au même titre que category l'est déjà côté application
-- (review-actions.ts refuse déjà une catégorie absente/invalide). La fonction
-- utilise directement les valeurs humaines soumises pour l'INSERT — plus de
-- lecture de source_payload->>'kind' / ->>'measurable'. review-actions.ts est
-- corrigé en parallèle pour ne plus muter source_payload avant l'appel RPC.
--
-- kind reste public.engagements.kind = text (CHECK, cf. migration 153) — pas
-- un enum Postgres, donc p_kind text, pas de cast ::engagement_kind.
--
-- CREATE OR REPLACE FUNCTION ne remplace une fonction que si sa signature
-- (types de paramètres) est identique. p_category/p_kind/p_measurable
-- changent l'arité (3 → 5 paramètres) : sans DROP explicite de l'ancienne
-- signature, Postgres créerait un second overload et laisserait l'ancienne
-- fonction à 3 paramètres (celle qui lit encore source_payload sans garde)
-- appelable en parallèle. On la supprime donc explicitement d'abord.

DROP FUNCTION IF EXISTS public.materialize_engagement_create_new(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.materialize_engagement_create_new(
  p_proposal_id  uuid,
  p_user_id      uuid,
  p_category     text,
  p_kind         text,
  p_measurable   boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec              record;
  v_org_id         uuid;
  v_engagement_id  uuid;
BEGIN
  IF p_category IS NULL THEN
    RAISE EXCEPTION 'Catégorie (p_category) requise';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('objectif', 'obligation', 'livrable', 'controle', 'penalite') THEN
    RAISE EXCEPTION 'Nature (p_kind) requise et doit être valide, reçu : %', p_kind;
  END IF;

  IF p_measurable IS NULL THEN
    RAISE EXCEPTION 'Mesurable (p_measurable) requis';
  END IF;

  SELECT * INTO rec FROM public.document_extraction_proposal WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposition % introuvable', p_proposal_id;
  END IF;

  IF rec.proposal_family <> 'engagement' THEN
    RAISE EXCEPTION 'Proposition % : famille % invalide (attendu engagement)', p_proposal_id, rec.proposal_family;
  END IF;

  SELECT target_entity_id INTO v_engagement_id
    FROM public.document_proposal_materialization
    WHERE proposal_id = p_proposal_id AND target_entity_type = 'engagement';
  IF FOUND THEN
    RETURN v_engagement_id;
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
    RAISE EXCEPTION 'Proposition % : aucune preuve (evidence) liée, création refusée', p_proposal_id;
  END IF;

  IF COALESCE(rec.source_excerpt, '') = '' THEN
    RAISE EXCEPTION 'Proposition % : aucun extrait source (source_excerpt), création refusée', p_proposal_id;
  END IF;

  SELECT organization_id INTO v_org_id FROM public.sites WHERE id = rec.target_site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chantier % introuvable', rec.target_site_id;
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
  ) RETURNING id INTO v_engagement_id;

  INSERT INTO public.document_proposal_materialization (
    organization_id, proposal_id,
    target_entity_type, target_entity_id,
    status, created_by
  ) VALUES (
    v_org_id, p_proposal_id, 'engagement', v_engagement_id, 'done', p_user_id
  ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

  UPDATE public.document_extraction_proposal
    SET review_status = 'materialized'
    WHERE id = p_proposal_id;

  RETURN v_engagement_id;
END;
$$;

COMMENT ON FUNCTION public.materialize_engagement_create_new(uuid, uuid, text, text, boolean) IS
  'P0-2C FIX_REQUIRED (438) : category/kind/measurable deviennent des '
  'paramètres humains obligatoires (plus de lecture de source_payload brut '
  'IA, plus de DEFAULT). Pending/rejected échouent AVANT toute écriture '
  '(validation review_status, aucune mutation de source_payload en amont). '
  'Idempotent, exige au moins une evidence liée.';
