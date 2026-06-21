-- Distribution d'actions à une entreprise (QR / lien) — 2026-06-21
--
-- Besoin terrain (Guillaume, BECIB) : le PV produit des actions ; on veut
-- envoyer à UNE entreprise SA liste d'actions, qu'elle coche (Fait / Impossible
-- + commentaire + photo + signature). Le retour remonte dans la mémoire du
-- chantier → le MOE cible ses visites → le prochain CR sait ce qui est fait.
--
-- Patron : strictement calqué sur intervention_tokens (mig 097/106) mais pour
-- l'objet site_actions (3e pilier, mig 099) au lieu de la checklist d'une
-- intervention. Un token = une « distribution » = un lot d'actions confié à une
-- entreprise.
--
-- Doctrine :
--   - token = permission, jamais identité (anti-pointage) ;
--   - recipient_label = l'ENTREPRISE, jamais un salarié nommé ;
--   - périmètre strict : l'externe ne voit / ne touche QUE les actions du lot ;
--   - la déclaration externe est une PREUVE, elle ne clôture PAS l'action côté
--     MOE (le statut interne reste sous contrôle humain — IA/externe propose,
--     humain valide) ;
--   - signature unique au niveau de la distribution (pas par action).

-- ── La distribution (le token / QR confié à une entreprise) ────────────────
CREATE TABLE IF NOT EXISTS public.action_distributions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token              text NOT NULL UNIQUE,
  site_id            uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  -- Réunion / PV d'origine (traçabilité). NULL = lot créé hors réunion.
  report_id          uuid REFERENCES public.site_reports(id) ON DELETE SET NULL,
  -- L'entreprise destinataire (jamais un salarié). Affiché sur la page publique.
  recipient_label    text NOT NULL,
  -- Lien optionnel vers l'entité entreprise normalisée (mig 137).
  company_id         uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  note               text,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,
  revoked_at         timestamptz,
  revoked_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Audit silencieux (comme intervention_tokens).
  accessed_at        timestamptz,
  access_count       integer NOT NULL DEFAULT 0,
  -- Preuve : signature + identité déclarée, posées à la soumission.
  submitted_at       timestamptz,
  submitted_by_name  text,
  signature_data_url text
);

CREATE INDEX IF NOT EXISTS action_distributions_site_idx
  ON public.action_distributions (site_id);
CREATE INDEX IF NOT EXISTS action_distributions_report_idx
  ON public.action_distributions (report_id) WHERE report_id IS NOT NULL;

COMMENT ON TABLE public.action_distributions IS
  'Lot d''actions confié à une entreprise via un lien/QR (mig 148). recipient_label = entreprise, jamais un salarié (anti-pointage). La déclaration est une preuve, pas une clôture.';

-- ── Périmètre : les actions du lot + la déclaration externe par action ──────
CREATE TABLE IF NOT EXISTS public.action_distribution_items (
  distribution_id    uuid NOT NULL REFERENCES public.action_distributions(id) ON DELETE CASCADE,
  action_id          uuid NOT NULL REFERENCES public.site_actions(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- DEMANDE DE PREUVE : MemorIA ne demande pas « est-ce fait ? » mais « montre-moi ».
  -- Si true, déclarer « fait » EXIGE une photo (preuve native, pas de l'auto-
  -- déclaratif). Le MOE peut la lever par action (ex. « envoyer fiche technique »).
  requires_proof_photo boolean NOT NULL DEFAULT true,
  -- Déclaration de l'entreprise sur CETTE action :
  --   pending = pas encore répondu · done = fait · blocked = impossible / bloqué.
  declared_status    text NOT NULL DEFAULT 'pending'
                       CHECK (declared_status IN ('pending', 'done', 'blocked')),
  declared_comment   text,
  declared_photo_path text,
  declared_at        timestamptz,
  PRIMARY KEY (distribution_id, action_id)
);

CREATE INDEX IF NOT EXISTS adi_action_idx
  ON public.action_distribution_items (action_id);

COMMENT ON TABLE public.action_distribution_items IS
  'Périmètre d''une distribution : actions confiées + déclaration externe (fait/impossible + commentaire + photo). Le serveur refuse toute action hors périmètre.';

-- ── Surcouche dénormalisée sur l'action (surfaçage bon marché) ─────────────
-- La dernière déclaration externe, recopiée sur l'action pour l'afficher sans
-- jointure dans les cockpits (« ✓ Fait — par Colas »). Ne pilote JAMAIS le
-- statut interne : c'est un écho de terrain, le MOE garde la main.
ALTER TABLE public.site_actions
  ADD COLUMN IF NOT EXISTS ext_status text
    CHECK (ext_status IS NULL OR ext_status IN ('done', 'blocked')),
  ADD COLUMN IF NOT EXISTS ext_comment text,
  ADD COLUMN IF NOT EXISTS ext_photo_path text,
  ADD COLUMN IF NOT EXISTS ext_at timestamptz,
  ADD COLUMN IF NOT EXISTS ext_by text;

COMMENT ON COLUMN public.site_actions.ext_status IS
  'Dernière déclaration externe (entreprise via action_distributions) : done | blocked. NULL = aucune. Écho de terrain, ne clôture pas l''action (doctrine IA propose / humain valide).';

-- ── RLS (service_role only, comme tout le domaine token) ───────────────────
ALTER TABLE public.action_distributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.action_distributions
  FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE public.action_distribution_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.action_distribution_items
  FOR ALL USING (auth.role() = 'service_role');
