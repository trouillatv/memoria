-- P0-2A (réalignement) — Engagement comme primitive canonique unique, deux
-- portes d'entrée.
--
-- Mandat Vincent 2026-09-24 : le circuit document→obligation de la migration
-- 435 (déjà appliquée en live, ZÉRO obligation métier réelle créée par ses
-- RPC) ne devient PAS le socle des « Prestations prévues ». Cette migration
-- ne touche PAS à 435 (fait historique conservé tel quel, capacité
-- secondaire non retirée) et n'ajoute rien à site_obligation.
--
-- Doctrine retenue : « Un Engagement décrit ce qui doit être vrai. Une
-- Prestation est un Engagement opérationnel récurrent (kind='obligation',
-- déjà supporté migration 153). Une Action n'existe que lorsqu'il faut agir. »
--
-- PORTE A (AO, existante, inchangée) : tender → tender_document →
--   proposition/curation → engagements (tender_id NOT NULL jusqu'ici).
-- PORTE B (CHANTIER, nouvelle) : site → document contractuel →
--   document_extraction_proposal (famille 'engagement') → curation humaine →
--   engagements (site_id renseigné, tender_id NULL).
--
-- Constat live (audit READ-ONLY préalable, requêtes information_schema) :
--   - engagements.tender_id est NOT NULL en prod (323 lignes, toutes AO).
--   - 49/54 sites (91 %) n'ont AUCUN contract_id : contract_id seul ne peut
--     PAS servir de portée chantier pour la porte B (données réelles, pas
--     une hypothèse). D'où l'ajout de engagements.site_id, indépendant de
--     contract_id (provenance ≠ portée, cf. mandat point 4).
--
-- Portée du lot : uniquement le socle structurel. Aucun extracteur, aucune
-- UI « Prestations prévues », aucun rattachement Live Writer, aucune
-- génération d'Action. Catégorisation (kind), preuve (proof_requirement) et
-- destination existent déjà (migrations 153/046/083) et suffisent — aucune
-- nouvelle taxonomie ajoutée ici.

-- ── 1. tender_id devient optionnel (élargissement de contrainte, sans perte)

ALTER TABLE public.engagements
  ALTER COLUMN tender_id DROP NOT NULL;

-- ── 2. Portée chantier (site_id) et provenance documentaire directe
--       (source_document_id), indépendantes du monde AO.

ALTER TABLE public.engagements
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES public.documents(id) ON DELETE NO ACTION;

CREATE INDEX IF NOT EXISTS idx_engagements_site_id ON public.engagements(site_id);
CREATE INDEX IF NOT EXISTS idx_engagements_source_document_id ON public.engagements(source_document_id);

-- ── 3. Invariants : deux portes, jamais orpheline ; provenance jamais floue.

DO $$
BEGIN
  -- Une page n'existe jamais sans document source identifiable, quel que
  -- soit le monde d'origine (généralise engagements_page_requires_document
  -- de la migration 241, qui ne connaissait que tender_document_id).
  ALTER TABLE public.engagements
    DROP CONSTRAINT IF EXISTS engagements_page_requires_document;
  ALTER TABLE public.engagements
    ADD CONSTRAINT engagements_page_requires_document
      CHECK (page_number IS NULL OR tender_document_id IS NOT NULL OR source_document_id IS NOT NULL);

  -- Une page ne flotte jamais entre deux documents à la fois : un Engagement
  -- a AU PLUS une provenance documentaire directe (AO xor chantier).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.engagements'::regclass
      AND conname = 'engagements_single_document_provenance'
  ) THEN
    ALTER TABLE public.engagements
      ADD CONSTRAINT engagements_single_document_provenance
        CHECK (NOT (tender_document_id IS NOT NULL AND source_document_id IS NOT NULL));
  END IF;

  -- Deux portes d'entrée, une seule primitive : un Engagement appartient
  -- forcément au monde AO (tender_id) ou au monde chantier (site_id), jamais
  -- ni l'un ni l'autre.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.engagements'::regclass
      AND conname = 'engagements_origin_door_check'
  ) THEN
    ALTER TABLE public.engagements
      ADD CONSTRAINT engagements_origin_door_check
        CHECK (tender_id IS NOT NULL OR site_id IS NOT NULL);
  END IF;
END;
$$;

-- ── 4. Nettoyage de provenance à la suppression physique du document source
--       (même discipline que clear_engagement_tender_document_provenance,
--       migration 241 : ne mute jamais l'Engagement lui-même, seulement son
--       pointeur de provenance devenu invalide).

CREATE OR REPLACE FUNCTION public.clear_engagement_source_document_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.engagements
  SET source_document_id = NULL,
      page_number = NULL
  WHERE source_document_id = OLD.id;

  RETURN OLD;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.documents'::regclass
      AND tgname = 'documents_clear_engagement_provenance_before_delete'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER documents_clear_engagement_provenance_before_delete
    BEFORE DELETE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.clear_engagement_source_document_provenance();
  END IF;
END;
$$;

-- ── 5. Nouvelle famille de proposition documentaire : 'engagement'.
--       Additive à la CHECK existante (même discipline que 371/435) —
--       'obligation' (435) N'EST PAS renommée : elle reste une capacité
--       secondaire distincte (obligations ponctuelles → site_obligation).

ALTER TABLE public.document_extraction_proposal
  DROP CONSTRAINT IF EXISTS document_extraction_proposal_proposal_family_check;

ALTER TABLE public.document_extraction_proposal
  ADD CONSTRAINT document_extraction_proposal_proposal_family_check
  CHECK (proposal_family IN (
    'reservation','action','decision','observation','deadline',
    'knowledge_fact','person','company','planning','obligation','engagement'
  ));

-- ── 6. Matérialisation : porte B uniquement (document → engagement, site
--       renseigné). Même registre générique document_proposal_materialization
--       que 435 (target_entity_type='engagement', aucune nouvelle table).
--
-- Règle curated/active minimale (mandat point 9) : il n'existe pas
-- d'équivalent « marché gagné » côté chantier. La validation humaine de la
-- proposition EST le geste d'activation : l'Engagement créé/rattaché passe
-- directement à 'active' (pas d'étape 'extracted'/'curated' intermédiaire,
-- contrairement au flux AO qui matérialise en masse avant curation
-- individuelle). curateEngagement() (lib/db/engagements.ts, inchangée) reste
-- disponible ensuite pour affiner kind/destination/proof_requirement — elle
-- est déjà agnostique de l'origine (AO ou chantier).

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

  -- IDEMPOTENCE avant review_status : même raison que materialize_obligation_*
  -- (migration 435) — un rejeu ne doit jamais être rejeté par son propre effet
  -- de bord sur review_status.
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

  -- engagements.source_excerpt est NOT NULL (CHECK 5-2000 caractères) : un
  -- Engagement doit toujours être traçable à un extrait, contrairement à
  -- site_obligation qui ne porte qu'un label (migration 435).
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
    'active',
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
  'P0-2A (réalignement) : matérialise une proposition engagement en NOUVEL '
  'engagement de porte B (site_id renseigné, tender_id NULL, status active '
  'directement — la validation humaine tient lieu d''activation). Idempotent, '
  'exige au moins une evidence liée.';

CREATE OR REPLACE FUNCTION public.materialize_engagement_link_existing(
  p_proposal_id    uuid,
  p_engagement_id  uuid,
  p_user_id        uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec                    record;
  v_org_id               uuid;
  v_engagement_site_id   uuid;
  v_engagement_org_id    uuid;
  v_existing_mat_id      uuid;
  v_existing_target_id   uuid;
  v_mat_id               uuid;
BEGIN
  SELECT * INTO rec FROM public.document_extraction_proposal WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposition % introuvable', p_proposal_id;
  END IF;

  IF rec.proposal_family <> 'engagement' THEN
    RAISE EXCEPTION 'Proposition % : famille % invalide (attendu engagement)', p_proposal_id, rec.proposal_family;
  END IF;

  SELECT id, target_entity_id INTO v_existing_mat_id, v_existing_target_id
    FROM public.document_proposal_materialization
    WHERE proposal_id = p_proposal_id AND target_entity_type = 'engagement';
  IF FOUND THEN
    IF v_existing_target_id = p_engagement_id THEN
      RETURN v_existing_mat_id;
    ELSE
      RAISE EXCEPTION 'Proposition % déjà matérialisée vers l''engagement % (rattachement vers % refusé)',
        p_proposal_id, v_existing_target_id, p_engagement_id;
    END IF;
  END IF;

  IF rec.review_status NOT IN ('accepted', 'edited') THEN
    RAISE EXCEPTION 'Proposition % : statut % non matérialisable (attendu accepted/edited)', p_proposal_id, rec.review_status;
  END IF;

  IF rec.target_site_id IS NULL THEN
    RAISE EXCEPTION 'Proposition % : aucun chantier cible (target_site_id)', p_proposal_id;
  END IF;

  SELECT site_id, organization_id INTO v_engagement_site_id, v_engagement_org_id
    FROM public.engagements WHERE id = p_engagement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Engagement % introuvable', p_engagement_id;
  END IF;

  IF v_engagement_site_id IS DISTINCT FROM rec.target_site_id THEN
    RAISE EXCEPTION 'Engagement % appartient au chantier %, attendu % (rattachement cross-site refusé)',
      p_engagement_id, v_engagement_site_id, rec.target_site_id;
  END IF;

  SELECT organization_id INTO v_org_id FROM public.sites WHERE id = rec.target_site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chantier % introuvable', rec.target_site_id;
  END IF;

  IF v_engagement_org_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'Engagement % organisation % incohérente avec le chantier (org %)',
      p_engagement_id, v_engagement_org_id, v_org_id;
  END IF;

  -- Zéro mutation d'un champ métier de l'engagement cible (même discipline
  -- que materialize_obligation_link_existing, migration 435).
  INSERT INTO public.document_proposal_materialization (
    organization_id, proposal_id,
    target_entity_type, target_entity_id,
    status, created_by
  ) VALUES (
    v_org_id, p_proposal_id, 'engagement', p_engagement_id, 'done', p_user_id
  ) RETURNING id INTO v_mat_id;

  UPDATE public.document_extraction_proposal
    SET review_status = 'materialized'
    WHERE id = p_proposal_id;

  RETURN v_mat_id;
END;
$$;

COMMENT ON FUNCTION public.materialize_engagement_link_existing IS
  'P0-2A (réalignement) : rattache une proposition engagement à un engagement '
  'EXISTANT du même chantier/organisation (porte B). N''écrit que '
  'document_proposal_materialization — ne modifie jamais un champ métier de '
  'l''engagement cible.';
