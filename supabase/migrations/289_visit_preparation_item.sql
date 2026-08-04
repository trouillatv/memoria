-- 289 — Préparation de visite : sélections humaines pré-démarrage.
--
-- Invariant central : visit_watchlist_item reste réservé au snapshot d'une visite
-- déjà créée (mig 196). Cette table est la couche PRÉPARATOIRE : l'utilisateur
-- choisit ce qu'il veut vérifier AVANT d'appuyer sur Démarrer.
--
-- Cycle de vie :
--   1. Préparer la visite → upsert dans cette table (toggle Ajouter / Retirer).
--   2. Démarrer → startVisitAction() fusionne ces items + propositions automatiques
--      → seedWatchlist() → snapshot immuable dans visit_watchlist_item.
--   3. consumed_at + consumed_by_report_id marquent la consommation.
--      Un item consommé n'est plus listé dans les prochaines préparations.
--
-- stable_key : clé métier de déduplication, identique au source_kind+source_ref
--   utilisé par seedWatchlist(). Exemples :
--   'attention:cs-uuid'    → pvAttention item (canonical_subject)
--   'verify:cs-uuid'       → pvToVerify item (canonical_subject)
--   'manual:uuid'          → point manuel ajouté par l'utilisateur
--
-- Rollback : DROP TABLE. Aucune donnée existante impactée.

CREATE TABLE IF NOT EXISTS public.site_visit_preparation_item (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  organization_id       uuid NOT NULL,
  -- Clé métier : une source ne peut être sélectionnée qu'une fois par utilisateur/chantier.
  stable_key            text NOT NULL,
  label                 text NOT NULL,
  -- Provenance : 'auto_attention' | 'auto_verify' | 'auto_important' | 'manual'
  source_kind           text NOT NULL,
  -- Référence à l'artifact source (canonical_subject_id, reserve_id, etc.) — nullable.
  source_ref            text,
  canonical_subject_id  uuid REFERENCES public.canonical_subject(id) ON DELETE SET NULL,
  priority              text NOT NULL DEFAULT 'normal'
                          CONSTRAINT prep_priority_check CHECK (priority IN ('critical', 'important', 'normal')),
  reason                text,
  prepared_by           text NOT NULL,   -- auth.uid() de l'utilisateur qui prépare
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- Lifecycle : null = active, non-null = consommée au démarrage de la visite.
  consumed_at           timestamptz,
  consumed_by_report_id uuid REFERENCES public.site_reports(id) ON DELETE SET NULL
);

-- Un utilisateur ne peut sélectionner la même source qu'une seule fois par chantier.
CREATE UNIQUE INDEX IF NOT EXISTS site_visit_prep_user_site_key
  ON public.site_visit_preparation_item (site_id, prepared_by, stable_key);

-- Index de lecture rapide pour la page de préparation.
CREATE INDEX IF NOT EXISTS site_visit_prep_active_idx
  ON public.site_visit_preparation_item (site_id, prepared_by)
  WHERE consumed_at IS NULL;

-- RLS : chaque utilisateur voit et modifie uniquement ses propres sélections.
ALTER TABLE public.site_visit_preparation_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_prep_items_select" ON public.site_visit_preparation_item
  FOR SELECT USING (prepared_by = auth.uid()::text);

CREATE POLICY "own_prep_items_insert" ON public.site_visit_preparation_item
  FOR INSERT WITH CHECK (prepared_by = auth.uid()::text);

CREATE POLICY "own_prep_items_update" ON public.site_visit_preparation_item
  FOR UPDATE USING (prepared_by = auth.uid()::text);

CREATE POLICY "own_prep_items_delete" ON public.site_visit_preparation_item
  FOR DELETE USING (prepared_by = auth.uid()::text);

COMMENT ON TABLE public.site_visit_preparation_item IS
  'Sélections préparatoires d''une visite (mig 289) — artefact éphémère par utilisateur/chantier. Consommé (consumed_at) au démarrage, jamais réutilisé entre deux visites. Distinct de visit_watchlist_item qui est le snapshot immuable d''une visite déjà créée.';

COMMENT ON COLUMN public.site_visit_preparation_item.stable_key IS
  'Clé métier de déduplication : attention:csId | verify:csId | manual:uuid. Contrainte UNIQUE(site_id, prepared_by, stable_key).';

COMMENT ON COLUMN public.site_visit_preparation_item.source_kind IS
  'Provenance : auto_attention (pvAttention) | auto_verify (pvToVerify) | auto_important (getImportantSubjects) | manual.';

COMMENT ON COLUMN public.site_visit_preparation_item.consumed_at IS
  'Marqué au démarrage de la visite. Null = sélection active. Non null = intégrée à consumed_by_report_id.';
