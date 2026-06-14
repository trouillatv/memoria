-- Compte-rendu multimodal de chantier (2026-06-14)
--
-- Doctrine "Mémoire assistée" : le terrain produit (voix + texte + photos +
-- pièces jointes) → l'IA transcrit puis PROPOSE des actions → l'humain VALIDE
-- → les éléments validés deviennent de vraies lignes. Le compte-rendu source
-- et ses pièces restent archivés à vie, même si l'IA échoue.
--
-- Règle fondamentale : l'artefact brut ne disparaît jamais.
-- L'IA ne crée jamais directement — chaque création passe par validation humaine.

-- ============================================================
-- Bucket privé : audio + fichiers arbitraires (PDF, image, plan, PV…)
-- ============================================================

INSERT INTO storage.buckets (id, name, public) VALUES
  ('site-reports', 'site-reports', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "site-reports read for authenticated" ON storage.objects;
CREATE POLICY "site-reports read for authenticated"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'site-reports' AND auth.role() = 'authenticated');

-- ============================================================
-- Table 1 : le compte-rendu source (artefact + transcription)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.site_reports (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                 uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  tenant_id               uuid NOT NULL,  -- single-tenant pilot : pas de table tenants
  organization_id         uuid,

  status                  text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',         -- créé, capture en cours
      'transcribing',  -- transcription audio en cours
      'ready',         -- transcript dispo (ou saisie manuelle), prêt à analyser
      'analyzing',     -- analyse IA en cours
      'proposed',      -- propositions IA disponibles, à curer
      'curated',       -- éléments validés créés
      'archived',      -- clos, conservé
      'failed'         -- IA en échec — artefact + pièces CONSERVÉS et visibles
    )),

  -- Artefact audio brut — nullable : un compte-rendu peut être texte seul
  audio_path              text,
  audio_mime              text,
  audio_duration_seconds  smallint,

  -- Transcription (couches : brute IA / corrigée humaine)
  transcript_raw          text,
  transcript_corrected    text,
  transcript_status       text NOT NULL DEFAULT 'none'
    CHECK (transcript_status IN ('none', 'pending', 'done', 'failed')),

  -- Notes saisies/corrigées au clavier — indépendantes de l'audio
  text_input              text,

  -- Renseigné quand status='failed' : l'artefact reste, on sait pourquoi l'IA a échoué
  analysis_error          text,

  created_by              uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sr_site_status_idx ON public.site_reports (site_id, status);

COMMENT ON TABLE public.site_reports IS
  'Compte-rendu multimodal de chantier. Artefact brut (audio) + transcription. L''IA propose, l''humain valide. Jamais supprimé, même en échec IA.';

-- ============================================================
-- Table 2 : pièces jointes (audio + photos + fichiers)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.site_report_attachments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id               uuid NOT NULL REFERENCES public.site_reports(id) ON DELETE CASCADE,
  kind                    text NOT NULL CHECK (kind IN ('audio', 'photo', 'file')),
  storage_path            text NOT NULL,
  filename                text,
  mime_type               text,
  size_bytes              bigint,
  sha256                  text,
  client_uuid             uuid,  -- idempotence upload offline-first
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sra_client_uuid_uq
  ON public.site_report_attachments (client_uuid) WHERE client_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS sra_report_idx ON public.site_report_attachments (report_id);

COMMENT ON TABLE public.site_report_attachments IS
  'Pièces d''un compte-rendu : audio, photos, fichiers (PDF/plan/PV/BL). Le binaire ne transite jamais par Postgres.';

-- ============================================================
-- Table 3 : propositions IA (à curer par l'humain)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.site_report_proposals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id               uuid NOT NULL REFERENCES public.site_reports(id) ON DELETE CASCADE,
  -- Une proposition = une DÉCISION détectée, routée selon sa nature.
  -- 'action' = "action ouverte" : sortie métier PRINCIPALE (Fred : "noter ce
  -- qu'il reste à faire"). Curable ensuite en mission/intervention ou conservée.
  -- 'client_memory' = savoir sur le client (route vers la mémoire client).
  type                    text NOT NULL CHECK (type IN (
    'action', 'intervention', 'mission', 'anomaly',
    'vigilance', 'note', 'proof_request', 'client_memory'
  )),
  payload                 jsonb NOT NULL DEFAULT '{}'::jsonb,  -- champs typés par type
  short_label             text NOT NULL,
  rationale               text,            -- extrait source / pourquoi cette proposition
  category                text,            -- AnomalyCategory pour les anomalies, null sinon
  -- Corps d'état (Menuiserie, Électricité, Plomberie, SOCOTEC, Livraison, Gros
  -- œuvre…). Texte libre nullable pour rester transversal (BTP/nettoyage/maintenance).
  -- L'écran de curation et le briefing regroupent par corps d'état.
  corps_etat              text,
  assigned_to             text,            -- responsable pressenti (corps d'état lead, sous-traitant, nom libre)
  ai_confidence           numeric,
  status                  text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'rejected')),

  -- Trace de la matérialisation après validation humaine
  created_entity_type     text,            -- 'action'|'intervention'|'mission'|'anomaly'|'site_note'
  created_entity_id       uuid,

  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS srp_report_status_idx ON public.site_report_proposals (report_id, status);

COMMENT ON TABLE public.site_report_proposals IS
  'Propositions IA issues d''un compte-rendu. L''humain accepte/édite/rejette, groupé par corps d''état. created_entity_* trace la ligne réelle créée après validation.';

-- ============================================================
-- Table 4 : actions ouvertes (LE nouvel objet métier central)
-- ============================================================
-- Aujourd'hui MemorIA a missions/interventions/anomalies/notes mais PAS
-- "action ouverte". Or une réunion de chantier produit d'abord des actions
-- ouvertes ; seules certaines deviennent des interventions planifiées.
-- Conservable telle quelle, planifiable (→ intervention), regroupée par corps
-- d'état, affectable à un responsable pressenti.
-- "Réunion chantier #N" = une VUE sur ces actions (ouvertes vs clôturées).

CREATE TABLE IF NOT EXISTS public.site_actions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                 uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  report_id               uuid REFERENCES public.site_reports(id) ON DELETE SET NULL,  -- réunion d'origine
  title                   text NOT NULL,
  body                    text,
  corps_etat              text,            -- Menuiserie, Électricité, Plomberie, SOCOTEC, Livraison…
  assigned_to             text,            -- responsable pressenti (corps d'état lead, sous-traitant, nom)
  status                  text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'planned', 'done', 'cancelled')),
  due_date                date,
  -- Si planifiée : trace de la ligne lourde créée (status='planned')
  converted_to_type       text,            -- 'mission'|'intervention'
  converted_to_id         uuid,
  created_by              uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  done_at                 timestamptz
);

CREATE INDEX IF NOT EXISTS sa_site_status_idx ON public.site_actions (site_id, status);
CREATE INDEX IF NOT EXISTS sa_report_idx ON public.site_actions (report_id);
CREATE INDEX IF NOT EXISTS sa_corps_idx ON public.site_actions (site_id, corps_etat);

COMMENT ON TABLE public.site_actions IS
  'Actions ouvertes d''un site — nouvel objet central. open→planned(→intervention)→done. Regroupées par corps d''état. "Réunion chantier #N" en est une vue.';

-- ============================================================
-- RLS : service role uniquement (server actions via admin client)
-- ============================================================

ALTER TABLE public.site_reports             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_report_attachments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_report_proposals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_actions             ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.site_reports
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_full_access" ON public.site_report_attachments
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_full_access" ON public.site_report_proposals
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_full_access" ON public.site_actions
  FOR ALL USING (auth.role() = 'service_role');
