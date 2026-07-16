-- ============================================================
-- 212 — Propositions de connaissance (couche d'extraction métier)
-- ============================================================
-- LA pièce manquante : la synthèse de visite ne doit plus rester enfermée dans
-- site_reports.debrief_analysis, NI écrire directement des actions/réserves/
-- décisions comme si elles étaient certaines. Elle PROJETTE ce qu'elle a compris
-- dans une table générique de PROPOSITIONS, visibles partout, distinctes des
-- objets validés. L'humain promeut ensuite chaque proposition vers l'objet
-- métier réel par un geste explicite.
--
-- Règle produit : « L'IA fait apparaître ce qui mérite l'attention ; l'humain
-- décide ce qui devient vrai dans le système. »
--
-- Une seule table = un seul cycle de vie, une seule déduplication, une seule
-- traçabilité, une seule UI « éléments proposés », zéro pollution des tables
-- finales.

CREATE TABLE IF NOT EXISTS public.site_knowledge_proposals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id               uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  -- Visite d'origine (la source). SET NULL si la visite est supprimée : la
  -- proposition, une fois promue, garde sa valeur indépendamment de la source.
  report_id             uuid REFERENCES public.site_reports(id) ON DELETE SET NULL,
  -- N° de synthèse qui a produit (ou rafraîchi) cette proposition.
  analysis_version      int NOT NULL DEFAULT 1,

  -- Nature de la proposition.
  kind                  text NOT NULL
    CHECK (kind IN ('action', 'vigilance', 'decision', 'knowledge', 'stakeholder', 'deadline')),
  -- Cycle de vie : proposée → confirmée (promue) | écartée | remplacée.
  status                text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'dismissed', 'superseded')),

  title                 text NOT NULL,
  body                  text,
  -- Champs propres à chaque type (priorité/owner/due pour une action ;
  -- person/organization/topics pour un intervenant ; etc.).
  payload               jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Indice de confiance IA (facultatif) : 'high' | 'medium' | 'low'.
  confidence            text,

  -- Traçabilité : de quelles captures vient la proposition.
  source_capture_ids    uuid[] NOT NULL DEFAULT '{}',

  -- Clé de déduplication STABLE, propre à chaque type (kind + site + éléments
  -- discriminants normalisés). Garantit qu'une re-synthèse ne duplique pas, ne
  -- ressuscite pas une proposition écartée, ne re-signale pas une confirmée.
  dedupe_key            text NOT NULL,

  -- Promotion : vers quel objet métier réel, et son id.
  promoted_object_type  text,   -- 'site_action' | 'site_reserve' | 'site_decision' | 'site_note' | 'site_intervenant' | 'site_obligation'
  promoted_object_id    uuid,
  -- Chaînage de versions : une proposition modifiée remplace la précédente.
  superseded_by         uuid REFERENCES public.site_knowledge_proposals(id) ON DELETE SET NULL,

  dismiss_reason        text,
  reviewed_at           timestamptz,
  reviewed_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Idempotence de la projection : une proposition = une ligne par (site, clé).
CREATE UNIQUE INDEX IF NOT EXISTS skp_site_dedupe_uidx
  ON public.site_knowledge_proposals (site_id, dedupe_key);

-- Requêtes de surface : « propositions ouvertes de tel type sur tel chantier ».
CREATE INDEX IF NOT EXISTS skp_site_kind_status_idx
  ON public.site_knowledge_proposals (site_id, kind, status);
-- Propositions d'une visite donnée.
CREATE INDEX IF NOT EXISTS skp_report_idx
  ON public.site_knowledge_proposals (report_id);
-- Agrégations « aujourd'hui » (Accueil).
CREATE INDEX IF NOT EXISTS skp_org_status_idx
  ON public.site_knowledge_proposals (organization_id, status);

COMMENT ON TABLE public.site_knowledge_proposals IS
  'Propositions IA (couche d''extraction métier) : ce que la synthèse de visite a compris, persisté en objets PROPOSÉS distincts des objets validés. Promotion humaine explicite vers site_actions / site_reserve / site_decisions / site_notes / site_intervenants / site_obligations.';

-- RLS : service role uniquement (server actions via admin client, filtre org
-- appliqué dans le code — cohérent avec site_actions / site_reports).
ALTER TABLE public.site_knowledge_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.site_knowledge_proposals
  FOR ALL USING (auth.role() = 'service_role');
