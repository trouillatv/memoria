-- P0-2A — Matérialisation document → obligation (CCTP/CCAP), sans extracteur.
--
-- Mandat Vincent (GO après audit P0-2A) : document_proposal_materialization
-- supporte déjà le pattern P1,P2,P3→O1 (UNIQUE(proposal_id, target_entity_type,
-- target_entity_id) scopé PAR proposition, pas par cible). Aucune nouvelle table
-- de lignée n'est nécessaire. Review (accept/reject) et matérialisation (ce
-- qu'une proposition acceptée produit) restent deux responsabilités distinctes :
-- cette migration n'ajoute rien à document_extraction_proposal.review_status,
-- elle ajoute seulement DEUX issues de matérialisation pour les propositions
-- de famille 'obligation' déjà acceptées/éditées :
--   - create_new     : nouvelle site_obligation (origine document, template_id
--                       NULL, origin_engagement_id NULL — distinguable des
--                       obligations catalogue/AO sans nouvelle colonne).
--   - link_existing   : AUCUNE nouvelle obligation, uniquement une ligne de
--                       matérialisation vers une obligation EXISTANTE du MÊME
--                       chantier — zéro mutation d'un champ métier de la cible.
--
-- Hors périmètre (explicite) : modification/suppression/supersession automatique
-- d'une obligation existante, réconciliation LLM/CBO-style. Raison : l'audit
-- READ-ONLY de site_obligation (même lot) confirme qu'il n'existe AUCUNE table
-- d'historique/événement ni trigger sur site_obligation — les fonctions
-- setObligationStatus/setObligationImportance/setObligationResponsible
-- (lib/db/obligations.ts) font un UPDATE direct, sans capture de l'état
-- antérieur (satisfied_at/satisfied_note ne sont pas réinitialisés en cas de
-- régression de statut). Tant que cette capacité n'existe pas, aucune décision
-- « V2 modifie O1 » ne peut être prise sans perte de vérité historique — elle
-- est donc explicitement différée à un audit/lot séparé.
--
-- target_entity_type reste du texte libre (aucun CHECK, confirmé migration 257
-- et toutes les migrations suivantes) : 'site_obligation' s'ajoute sans DDL,
-- sans second mécanisme de mapping.

ALTER TABLE document_extraction_proposal
  DROP CONSTRAINT IF EXISTS document_extraction_proposal_proposal_family_check;

ALTER TABLE document_extraction_proposal
  ADD CONSTRAINT document_extraction_proposal_proposal_family_check
  CHECK (proposal_family IN (
    'reservation','action','decision','observation','deadline',
    'knowledge_fact','person','company','planning','obligation'
  ));

-- ── create_new ───────────────────────────────────────────────────────────────
-- Crée une nouvelle site_obligation à partir d'une proposition 'obligation'
-- acceptée/éditée, avec preuve documentaire (au moins une evidence liée).
-- Idempotent : un rejeu retourne l'obligation déjà créée, jamais une deuxième.
CREATE OR REPLACE FUNCTION public.materialize_obligation_create_new(
  p_proposal_id uuid,
  p_user_id     uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec              record;
  v_org_id         uuid;
  v_obligation_id  uuid;
BEGIN
  SELECT * INTO rec FROM public.document_extraction_proposal WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposition % introuvable', p_proposal_id;
  END IF;

  IF rec.proposal_family <> 'obligation' THEN
    RAISE EXCEPTION 'Proposition % : famille % invalide (attendu obligation)', p_proposal_id, rec.proposal_family;
  END IF;

  -- IDEMPOTENCE : vérifiée AVANT le statut de review. Le premier appel réussi
  -- fait passer review_status à 'materialized' — si ce garde-fou passait après,
  -- un simple rejeu (même proposition, même appel) serait rejeté par son PROPRE
  -- effet de bord au lieu de retourner la cible déjà créée.
  SELECT target_entity_id INTO v_obligation_id
    FROM public.document_proposal_materialization
    WHERE proposal_id = p_proposal_id AND target_entity_type = 'site_obligation';
  IF FOUND THEN
    RETURN v_obligation_id;
  END IF;

  IF rec.review_status NOT IN ('accepted', 'edited') THEN
    RAISE EXCEPTION 'Proposition % : statut % non matérialisable (attendu accepted/edited)', p_proposal_id, rec.review_status;
  END IF;

  IF rec.target_site_id IS NULL THEN
    RAISE EXCEPTION 'Proposition % : aucun chantier cible (target_site_id)', p_proposal_id;
  END IF;

  -- Preuve documentaire obligatoire : pas de création sans evidence liée.
  IF NOT EXISTS (
    SELECT 1 FROM public.document_proposal_evidence WHERE proposal_id = p_proposal_id
  ) THEN
    RAISE EXCEPTION 'Proposition % : aucune preuve (evidence) liée, création refusée', p_proposal_id;
  END IF;

  SELECT organization_id INTO v_org_id FROM public.sites WHERE id = rec.target_site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chantier % introuvable', rec.target_site_id;
  END IF;

  INSERT INTO public.site_obligation (
    site_id, organization_id, template_id,
    label, responsible_role, status, importance,
    verification_kind,
    origin_excerpt, origin_page,
    created_by
  ) VALUES (
    rec.target_site_id, v_org_id, NULL,
    COALESCE(rec.reviewed_label, rec.label),
    COALESCE(rec.source_payload->>'responsibleRole', 'entreprise'),
    'a_produire',
    COALESCE(rec.source_payload->>'importance', 'moyenne'),
    COALESCE(rec.source_payload->>'verificationKind', 'document'),
    rec.source_excerpt,
    rec.source_page,
    p_user_id
  ) RETURNING id INTO v_obligation_id;

  INSERT INTO public.document_proposal_materialization (
    organization_id, proposal_id,
    target_entity_type, target_entity_id,
    status, created_by
  ) VALUES (
    v_org_id, p_proposal_id, 'site_obligation', v_obligation_id, 'done', p_user_id
  ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

  UPDATE public.document_extraction_proposal
    SET review_status = 'materialized'
    WHERE id = p_proposal_id;

  RETURN v_obligation_id;
END;
$$;

COMMENT ON FUNCTION public.materialize_obligation_create_new IS
  'P0-2A : matérialise une proposition obligation en NOUVELLE site_obligation '
  '(origine document, template_id NULL). Idempotent, exige au moins une evidence liée.';

-- ── link_existing ────────────────────────────────────────────────────────────
-- Rattache une proposition 'obligation' à une site_obligation EXISTANTE du même
-- chantier, sans créer de ligne et SANS modifier aucun champ métier de la cible.
CREATE OR REPLACE FUNCTION public.materialize_obligation_link_existing(
  p_proposal_id   uuid,
  p_obligation_id uuid,
  p_user_id       uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec                   record;
  v_org_id              uuid;
  v_obligation_site_id  uuid;
  v_obligation_org_id   uuid;
  v_existing_mat_id     uuid;
  v_existing_target_id  uuid;
  v_mat_id              uuid;
BEGIN
  SELECT * INTO rec FROM public.document_extraction_proposal WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposition % introuvable', p_proposal_id;
  END IF;

  IF rec.proposal_family <> 'obligation' THEN
    RAISE EXCEPTION 'Proposition % : famille % invalide (attendu obligation)', p_proposal_id, rec.proposal_family;
  END IF;

  -- IDEMPOTENCE / CONFLIT : vérifiée AVANT le statut de review (même raison que
  -- create_new — le premier appel réussi fait passer review_status à
  -- 'materialized', un rejeu ne doit jamais être rejeté par son propre effet de
  -- bord). Une proposition ne porte qu'UNE seule décision de matérialisation.
  -- Rejeu vers la MÊME cible = no-op. Rejeu vers une cible DIFFÉRENTE = conflit
  -- explicite (aucune réconciliation automatique, hors périmètre P0-2A) :
  -- l'appelant doit trancher, la fonction ne le fait jamais.
  SELECT id, target_entity_id INTO v_existing_mat_id, v_existing_target_id
    FROM public.document_proposal_materialization
    WHERE proposal_id = p_proposal_id AND target_entity_type = 'site_obligation';
  IF FOUND THEN
    IF v_existing_target_id = p_obligation_id THEN
      RETURN v_existing_mat_id;
    ELSE
      RAISE EXCEPTION 'Proposition % déjà matérialisée vers l''obligation % (rattachement vers % refusé)',
        p_proposal_id, v_existing_target_id, p_obligation_id;
    END IF;
  END IF;

  IF rec.review_status NOT IN ('accepted', 'edited') THEN
    RAISE EXCEPTION 'Proposition % : statut % non matérialisable (attendu accepted/edited)', p_proposal_id, rec.review_status;
  END IF;

  IF rec.target_site_id IS NULL THEN
    RAISE EXCEPTION 'Proposition % : aucun chantier cible (target_site_id)', p_proposal_id;
  END IF;

  SELECT site_id, organization_id INTO v_obligation_site_id, v_obligation_org_id
    FROM public.site_obligation WHERE id = p_obligation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Obligation % introuvable', p_obligation_id;
  END IF;

  IF v_obligation_site_id <> rec.target_site_id THEN
    RAISE EXCEPTION 'Obligation % appartient au chantier %, attendu % (rattachement cross-site refusé)',
      p_obligation_id, v_obligation_site_id, rec.target_site_id;
  END IF;

  SELECT organization_id INTO v_org_id FROM public.sites WHERE id = rec.target_site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chantier % introuvable', rec.target_site_id;
  END IF;

  IF v_obligation_org_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'Obligation % organisation % incohérente avec le chantier (org %)',
      p_obligation_id, v_obligation_org_id, v_org_id;
  END IF;

  -- Écriture UNIQUEMENT du journal de matérialisation : ZÉRO UPDATE sur
  -- site_obligation. La cible n'est jamais mutée par ce chemin.
  INSERT INTO public.document_proposal_materialization (
    organization_id, proposal_id,
    target_entity_type, target_entity_id,
    status, created_by
  ) VALUES (
    v_org_id, p_proposal_id, 'site_obligation', p_obligation_id, 'done', p_user_id
  ) RETURNING id INTO v_mat_id;

  UPDATE public.document_extraction_proposal
    SET review_status = 'materialized'
    WHERE id = p_proposal_id;

  RETURN v_mat_id;
END;
$$;

COMMENT ON FUNCTION public.materialize_obligation_link_existing IS
  'P0-2A : rattache une proposition obligation à une site_obligation EXISTANTE '
  'du même chantier/organisation. N''écrit que document_proposal_materialization '
  '— ne modifie jamais un champ métier de l''obligation cible.';
