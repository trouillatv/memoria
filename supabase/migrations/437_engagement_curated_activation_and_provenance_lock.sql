-- P0-2A FIX_REQUIRED (mandat Vincent 2026-09-24, revue post-436) — trois
-- corrections doctrinales avant clôture. N'édite JAMAIS 436 (déjà appliquée
-- en live) : additive uniquement. Zéro Engagement porte B réel en prod à ce
-- jour (source_type='manual' : 0 ligne, cf. audit live) — aucun backfill.
--
-- 1. curated ≠ active — validation humaine de l'extraction n'est pas
--    l'entrée en vigueur de la règle (ex. CCTP importé en septembre, clause
--    validée, contrat applicable seulement au 01/11). materialize_engagement_
--    create_new matérialisait directement en 'active' (commentaire 436 :
--    « la validation humaine EST le geste d'activation ») — Vincent ne valide
--    pas cette conflation. engagement_status possède déjà 'curated' (ENUM,
--    migration antérieure à 436) : aucun changement de schéma requis, la
--    fonction est corrigée pour matérialiser en 'curated'. L'activation reste
--    un geste séparé et explicite (lib/db/engagements.ts::activateEngagement,
--    même esprit que activateEngagementsForContract côté AO — pas de moteur
--    de dates effective_date/expires_date, exclu du périmètre).
--
-- 2. Provenance documentaire jamais silencieusement perdue — le trigger
--    documents_clear_engagement_provenance_before_delete (436) neutralisait
--    engagements.source_document_id/page_number AVANT une suppression
--    physique de documents, contournant le ON DELETE NO ACTION déjà posé sur
--    engagements_source_document_id_fkey. Un Engagement contractuel doit
--    rester traçable jusqu'à sa preuve documentaire exacte : on retire ce
--    trigger pour laisser la contrainte FK NO ACTION bloquer la suppression
--    d'un document tant qu'un Engagement le référence. Le soft-delete
--    (documents.deleted_at, seul mécanisme de suppression réellement exercé
--    par l'application — cf. lib/db/documents.ts::softDeleteDocument) n'est
--    pas affecté : la ligne documents subsiste, la provenance reste intacte.
--
-- 3. Origine exclusive — engagements_origin_door_check (436) acceptait
--    tender_id ET site_id renseignés simultanément (OR non exclusif). Deux
--    portes, une primitive : jamais les deux mondes à la fois. Durci en XOR
--    strict.
--
-- Portée inchangée par rapport à 436 : aucun extracteur, aucune UI, aucune
-- Action générée, aucune taxonomie nouvelle (category/kind existants
-- suffisent, cf. audit live category='frequency' déjà porteur du signal
-- récurrent — voir rapport HARD STOP, Issue 3).

-- ── 1. Origine exclusive stricte (XOR tender_id / site_id).

ALTER TABLE public.engagements
  DROP CONSTRAINT IF EXISTS engagements_origin_door_check;

ALTER TABLE public.engagements
  ADD CONSTRAINT engagements_origin_door_check
    CHECK (
      (tender_id IS NOT NULL AND site_id IS NULL)
      OR (tender_id IS NULL AND site_id IS NOT NULL)
    );

-- ── 2. Retrait du trigger de nettoyage de provenance (436) — la FK
--       engagements_source_document_id_fkey (ON DELETE NO ACTION, posée par
--       436) reprend son rôle naturel : bloquer la suppression physique d'un
--       document tant qu'un Engagement pointe dessus.

DROP TRIGGER IF EXISTS documents_clear_engagement_provenance_before_delete ON public.documents;
DROP FUNCTION IF EXISTS public.clear_engagement_source_document_provenance();

-- ── 3. Matérialisation porte B : 'curated', jamais 'active' directement.

CREATE OR REPLACE FUNCTION public.materialize_engagement_create_new(
  p_proposal_id uuid,
  p_user_id     uuid,
  p_category    text DEFAULT 'other'
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
    NULLIF(rec.source_payload->>'kind', ''),
    COALESCE(rec.reviewed_label, rec.label),
    COALESCE((rec.source_payload->>'measurable')::boolean, false),
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

COMMENT ON FUNCTION public.materialize_engagement_create_new IS
  'P0-2A FIX_REQUIRED (437) : matérialise une proposition engagement en NOUVEL '
  'engagement de porte B (site_id renseigné, tender_id NULL, status ''curated'' '
  '— validation de l''extraction, PAS activation). L''activation vers ''active'' '
  'est un geste séparé et explicite (lib/db/engagements.ts::activateEngagement). '
  'Idempotent, exige au moins une evidence liée.';
