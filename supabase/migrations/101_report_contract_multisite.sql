-- Compte-rendu = objet de premier rang, multi-sites (2026-06-15)
--
-- Réalité BTP : une réunion du lundi au niveau CONTRAT (Lycée de Païta) traite
-- plusieurs sites (Bâtiment A/B/C, Voirie, Parking). Rattacher le compte-rendu
-- à UN seul site était faux. Le compte-rendu devient le conteneur ; chaque
-- décision est ROUTÉE vers son site ; les sorties (actions/notes/anomalies)
-- continuent de vivre sur le site.
--
-- Phase A : type contrat|site + multi-sites + routing IA confirmé par l'humain.
-- (Réunion libre / actions sans site = Phase B, non incluse ici.)
-- Additif aux migrations 099/100 (déjà appliquées).

-- ── site_reports : niveau de la réunion ────────────────────────────────────
ALTER TABLE public.site_reports
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'site'
    CHECK (type IN ('contract', 'site', 'free'));

ALTER TABLE public.site_reports
  ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL;

ALTER TABLE public.site_reports
  ADD COLUMN IF NOT EXISTS title text;

-- Une réunion contrat/libre n'a pas de site unique : site_id devient nullable.
ALTER TABLE public.site_reports
  ALTER COLUMN site_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS sr_contract_idx ON public.site_reports (contract_id);

COMMENT ON COLUMN public.site_reports.type IS
  'Niveau de la réunion : contract (multi-sites d''un contrat) | site (un site) | free (libre, Phase B).';
COMMENT ON COLUMN public.site_reports.site_id IS
  'Site principal (réunion site). NULL pour une réunion contrat/libre — voir report_sites.';

-- ── report_sites : sites touchés par une réunion (M:N) ─────────────────────
-- Réunion site → 1 ligne. Réunion contrat → N lignes (sites réellement routés).
-- C'est par cette table que le compte-rendu apparaît dans le journal d'un site.
CREATE TABLE IF NOT EXISTS public.report_sites (
  report_id   uuid NOT NULL REFERENCES public.site_reports(id) ON DELETE CASCADE,
  site_id     uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, site_id)
);

CREATE INDEX IF NOT EXISTS report_sites_site_idx ON public.report_sites (site_id);

COMMENT ON TABLE public.report_sites IS
  'Sites touchés par un compte-rendu (M:N). Une réunion contrat distribue ses décisions sur plusieurs sites.';

-- ── proposals : site routé pour chaque décision ────────────────────────────
-- L'IA détecte le site (parmi ceux du contrat) ; l'humain confirme à la curation.
ALTER TABLE public.site_report_proposals
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.site_report_proposals.site_id IS
  'Site vers lequel cette décision est routée (réunion contrat). Détecté par l''IA, confirmé par l''humain.';

-- ── RLS pour la nouvelle table ─────────────────────────────────────────────
ALTER TABLE public.report_sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.report_sites
  FOR ALL USING (auth.role() = 'service_role');
