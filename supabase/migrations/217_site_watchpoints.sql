-- ============================================================
-- 217 — Points de vigilance (Vincent 2026-07-17)
-- ============================================================
-- Le 5ᵉ promoteur. Une vigilance proposée par MemorIA ne pouvait pas être
-- confirmée : promoteProposal levait « promotion non supportée ». Le vide de la
-- Mémoire n'était pas de l'UX, c'était un cycle métier incomplet.
--
-- ── POURQUOI PAS site_notes ────────────────────────────────────────────────
-- Règle posée par Vincent : « site_notes peut être la cible uniquement si la
-- table sait porter kind=vigilance, statut actif/résolu, provenance, date, et
-- l'éventuelle transformation en réserve. Sinon, mieux vaut un petit objet
-- site_watchpoints plutôt que d'enterrer une vigilance dans une note générique. »
--
-- site_notes (mig 033) ne sait rien porter de tout ça : pas de kind, pas de
-- statut, pas de provenance, pas d'organisation, et un `body` plafonné à 140
-- caractères. Surtout, sa doctrine INTERDIT la nature même d'une vigilance :
--
--   « Format descriptif passif uniquement (verrou V4 : pas de formulations de
--     contrôle humain "Pense à...", "Attention à...") »
--
-- Une vigilance EST une formulation d'attention. L'y verser violerait le verrou
-- de la table. On crée donc l'objet, comme prévu.
--
-- ── LA DOCTRINE ────────────────────────────────────────────────────────────
-- Une vigilance NE DEVIENT JAMAIS une réserve automatiquement : la portée
-- contractuelle d'une réserve engage l'entreprise. La transformation est un
-- geste humain explicite, tracé ici (converted_reserve_id).

CREATE TABLE IF NOT EXISTS public.site_watchpoints (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id               uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,

  -- PROVENANCE : de quelle visite vient ce point. SET NULL si la visite est
  -- supprimée — la vigilance confirmée garde sa valeur sans sa source.
  report_id             uuid REFERENCES public.site_reports(id) ON DELETE SET NULL,
  -- Les captures qui l'ont fait apparaître (« Source : mémo vocal n°2 »).
  source_capture_ids    uuid[] NOT NULL DEFAULT '{}',

  -- Le risque, dit avec les mots de celui qui l'a dit.
  title                 text NOT NULL,
  -- L'impact : POURQUOI ça mérite l'attention.
  body                  text,

  -- Actif tant que personne ne l'a levé. 'converted' = devenu une réserve par un
  -- geste humain — la vigilance ne disparaît pas, elle dit ce qu'elle est devenue.
  status                text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'resolved', 'converted')),
  resolved_at           timestamptz,
  resolved_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- La réserve née de cette vigilance (jamais automatique).
  converted_reserve_id  uuid,

  -- Qui l'a retenue, et quand. Une confirmation est un ACTE : il a un auteur.
  confirmed_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_at          timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

-- « Ce qui demande l'attention sur ce chantier » — la requête de toutes les surfaces.
CREATE INDEX IF NOT EXISTS swp_site_status_idx
  ON public.site_watchpoints (site_id, status)
  WHERE deleted_at IS NULL;
-- Les vigilances issues d'une visite donnée.
CREATE INDEX IF NOT EXISTS swp_report_idx
  ON public.site_watchpoints (report_id);

COMMENT ON TABLE public.site_watchpoints IS
  'Points de vigilance CONFIRMÉS par un humain (promotion depuis site_knowledge_proposals, kind=vigilance). Une vigilance ne devient JAMAIS une réserve automatiquement : la conversion est un geste explicite (converted_reserve_id). Cible dédiée car site_notes (mig 033) interdit les formulations d''attention (verrou V4) et ne porte ni kind, ni statut, ni provenance.';

ALTER TABLE public.site_watchpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.site_watchpoints
  FOR ALL USING (auth.role() = 'service_role');
