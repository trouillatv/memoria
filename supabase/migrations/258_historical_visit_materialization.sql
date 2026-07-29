-- Migration 258 — Matérialisation atomique des visites historiques importées.
--
-- Doctrine : 1 PV historique = 1 visite historique importée (Sprint 4C.2).
-- Trois invariants :
--   · Atomicité SQL : tout passe par l'RPC, jamais une série de server actions.
--   · Date certaine : p_visit_date = document.effective_date, jamais started_at.
--   · Idempotence : UNIQUE(extraction_run_id) — un run ne peut créer qu'une visite.
--
-- knowledge_fact / person / company → post-RPC TypeScript (pipeline asynchrone).
-- La fonction retourne site_reports.id. Appelée via supabase.rpc() admin client.

-- ── 1. COLONNES DE PROVENANCE SUR SITE_REPORTS ──────────────────────────────

ALTER TABLE public.site_reports
  ADD COLUMN IF NOT EXISTS source_document_id uuid
    REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extraction_run_id  uuid
    REFERENCES public.document_extraction_run(id) ON DELETE SET NULL;

-- Un run ne peut matérialiser qu'une seule visite (idempotence garantie en DB)
CREATE UNIQUE INDEX IF NOT EXISTS sr_extraction_run_uidx
  ON public.site_reports (extraction_run_id)
  WHERE extraction_run_id IS NOT NULL;

COMMENT ON COLUMN public.site_reports.source_document_id IS
  'Document PV historique dont est issue cette visite importée.';
COMMENT ON COLUMN public.site_reports.extraction_run_id IS
  'Run d''extraction IA source. UNIQUE : 1 run → 1 visite max.';

-- ── 2. EXTENSION CONTRAINTE SOURCE SUR SITE_DECISIONS ───────────────────────

ALTER TABLE public.site_decisions
  DROP CONSTRAINT IF EXISTS site_decisions_source_check;
ALTER TABLE public.site_decisions
  ADD CONSTRAINT site_decisions_source_check
  CHECK (source IN ('meeting', 'transcript', 'human', 'historical_import'));

-- ── 3. FONCTION RPC — MATÉRIALISATION ATOMIQUE ──────────────────────────────
--
-- Appelée APRÈS que l'humain a revu les propositions (accepted / edited).
-- Crée : site_report (origin='import', status='curated') + tous les artefacts
-- métier (réserves, actions, décisions, observations vigilance, échéances).
-- Enregistre chaque création dans document_proposal_materialization (invariant 7).
-- Met à jour review_status → 'materialized' pour chaque proposition traitée.
-- Met à jour document_extraction_run.status → 'materialized' ou
-- 'partially_materialized' (si des knowledge_fact restent à traiter en TS).

CREATE OR REPLACE FUNCTION public.materialize_historical_visit(
  p_run_id      uuid,
  p_user_id     uuid,
  p_site_id     uuid,
  p_visit_date  date,
  p_visit_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id  uuid;
  v_org_id     uuid;
  v_tenant_id  uuid;
  v_doc_id     uuid;
  v_entity_id  uuid;
  v_eff_label  text;
  v_eff_desc   text;
  v_due_date   date;
  v_has_kf     boolean := false;
  rec          record;
BEGIN
  -- IDEMPOTENCE : si la visite existe déjà pour ce run, on la retourne sans rien toucher.
  SELECT id INTO v_report_id
    FROM public.site_reports
    WHERE extraction_run_id = p_run_id;
  IF FOUND THEN RETURN v_report_id; END IF;

  -- Métadonnées du run
  SELECT organization_id, document_id
    INTO v_org_id, v_doc_id
    FROM public.document_extraction_run
    WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % introuvable', p_run_id;
  END IF;

  -- tenant_id du site (single-tenant pilot : une seule valeur par org)
  SELECT tenant_id INTO v_tenant_id
    FROM public.sites
    WHERE id = p_site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Site % introuvable', p_site_id;
  END IF;

  -- ── Création de la visite historique ──────────────────────────────────────
  INSERT INTO public.site_reports (
    site_id, tenant_id, organization_id,
    status, origin,
    text_input,
    source_document_id, extraction_run_id,
    created_by
  ) VALUES (
    p_site_id,
    v_tenant_id,
    v_org_id,
    'curated',
    'import',
    COALESCE(
      NULLIF(trim(p_visit_title), ''),
      'Visite importée — ' || to_char(p_visit_date, 'DD/MM/YYYY')
    ),
    v_doc_id,
    p_run_id,
    p_user_id
  )
  RETURNING id INTO v_report_id;

  -- ── Matérialisation des propositions acceptées / éditées ──────────────────
  -- knowledge_fact, person, company → ignorés ici (pipeline TypeScript post-RPC)
  FOR rec IN
    SELECT *
      FROM public.document_extraction_proposal
      WHERE extraction_run_id = p_run_id
        AND review_status IN ('accepted', 'edited')
        AND proposal_family NOT IN ('knowledge_fact', 'person', 'company')
    ORDER BY created_at
  LOOP
    -- Valeurs effectives : reviewed_* pour 'edited', extracted brut pour 'accepted'
    v_eff_label := COALESCE(rec.reviewed_label, rec.label);
    v_eff_desc  := COALESCE(rec.reviewed_description, rec.description);
    v_entity_id := NULL;

    CASE rec.proposal_family

      WHEN 'reservation' THEN
        INSERT INTO public.site_reserve (
          site_id, organization_id,
          label, issued_on, issued_by,
          created_by
        ) VALUES (
          p_site_id, v_org_id,
          v_eff_label,
          p_visit_date,
          rec.source_payload->>'issued_by',
          p_user_id
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          status, created_by
        ) VALUES (
          v_org_id, rec.id,
          'site_reserve', v_entity_id,
          'done', p_user_id
        ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

      WHEN 'action' THEN
        v_due_date := CASE
          WHEN rec.source_payload->>'due_date' IS NOT NULL
          THEN (rec.source_payload->>'due_date')::date
          ELSE NULL
        END;
        INSERT INTO public.site_actions (
          site_id, report_id,
          title, body,
          due_date,
          created_by, created_from
        ) VALUES (
          p_site_id, v_report_id,
          v_eff_label, v_eff_desc,
          v_due_date,
          p_user_id, 'historical_import'
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          status, created_by
        ) VALUES (
          v_org_id, rec.id,
          'site_action', v_entity_id,
          'done', p_user_id
        ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

      WHEN 'decision' THEN
        INSERT INTO public.site_decisions (
          site_id, report_id,
          titre, description,
          date_decision,
          source,
          created_by
        ) VALUES (
          p_site_id, v_report_id,
          v_eff_label, v_eff_desc,
          COALESCE(
            CASE WHEN rec.source_payload->>'date_decision' IS NOT NULL
              THEN (rec.source_payload->>'date_decision')::date
              ELSE NULL
            END,
            p_visit_date
          ),
          'historical_import',
          p_user_id
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          status, created_by
        ) VALUES (
          v_org_id, rec.id,
          'site_decision', v_entity_id,
          'done', p_user_id
        ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

      WHEN 'observation' THEN
        INSERT INTO public.site_report_proposals (
          report_id, type, status,
          short_label, payload
        ) VALUES (
          v_report_id, 'vigilance', 'accepted',
          v_eff_label,
          jsonb_build_object('description', COALESCE(v_eff_desc, ''))
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          status, created_by
        ) VALUES (
          v_org_id, rec.id,
          'site_report_proposal', v_entity_id,
          'done', p_user_id
        ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

      WHEN 'deadline' THEN
        v_due_date := CASE
          WHEN rec.source_payload->>'due_date' IS NOT NULL
          THEN (rec.source_payload->>'due_date')::date
          ELSE NULL
        END;
        INSERT INTO public.site_deadlines (
          site_id, organization_id, report_id,
          title, constraint_text, due_date,
          status,
          created_from, created_by
        ) VALUES (
          p_site_id, v_org_id, v_report_id,
          v_eff_label,
          rec.source_payload->>'constraint_text',
          v_due_date,
          CASE WHEN v_due_date IS NOT NULL THEN 'planned' ELSE 'to_plan' END,
          'historical_import', p_user_id
        ) RETURNING id INTO v_entity_id;

        INSERT INTO public.document_proposal_materialization (
          organization_id, proposal_id,
          target_entity_type, target_entity_id,
          status, created_by
        ) VALUES (
          v_org_id, rec.id,
          'site_deadline', v_entity_id,
          'done', p_user_id
        ) ON CONFLICT (proposal_id, target_entity_type, target_entity_id) DO NOTHING;

      ELSE
        -- Famille non reconnue — ignorée silencieusement (forward-compat)
        CONTINUE;

    END CASE;

    -- Marque la proposition comme matérialisée
    UPDATE public.document_extraction_proposal
      SET review_status = 'materialized',
          reviewed_at   = COALESCE(reviewed_at, now())
      WHERE id = rec.id;

  END LOOP;

  -- Vérifie si des knowledge_fact / person / company restent à traiter en TS
  SELECT EXISTS (
    SELECT 1
      FROM public.document_extraction_proposal
      WHERE extraction_run_id = p_run_id
        AND review_status IN ('accepted', 'edited')
        AND proposal_family IN ('knowledge_fact', 'person', 'company')
  ) INTO v_has_kf;

  -- Met à jour le statut du run
  UPDATE public.document_extraction_run
    SET status       = CASE WHEN v_has_kf THEN 'partially_materialized' ELSE 'materialized' END,
        completed_at = COALESCE(completed_at, now())
    WHERE id = p_run_id;

  RETURN v_report_id;
END;
$$;

COMMENT ON FUNCTION public.materialize_historical_visit(uuid, uuid, uuid, date, text) IS
  'Crée atomiquement une visite historique importée depuis un run d''extraction IA. '
  'Retourne site_reports.id. Idempotent (UNIQUE extraction_run_id). '
  'knowledge_fact / person / company ignorés : traitement post-RPC en TypeScript.';
