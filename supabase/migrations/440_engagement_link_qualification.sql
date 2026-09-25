-- ============================================================
-- 440 — Qualification humaine du lien Action ↔ Engagement (P0-4C, GO Vincent 2026-09-25)
-- ============================================================
-- Doctrine : le lien P0-4B (mig 439) signifie « un humain considère que cette
-- Action concerne cet Engagement ». P0-4C répond à « pourquoi ? » — jamais à
-- « est-ce respecté ? ». La qualification n'est JAMAIS : une conformité, une
-- non-conformité, un écart contractuel confirmé, une modification acceptée de
-- l'Engagement, ou une décision juridique.
--
-- 1) site_action_engagement_links passe du DELETE physique à une fermeture
--    logique (removed_at/removed_by) : une qualification passée doit survivre
--    au retrait du rapprochement. L'unicité (site_action_id, engagement_id)
--    ne s'applique plus qu'aux liens ACTIFS (removed_at IS NULL) — un nouveau
--    rapprochement futur reste possible après un retrait.
--
-- 2) site_action_engagement_link_events est append-only : chaque qualification
--    est un événement horodaté, jamais un UPDATE. La qualification courante
--    d'un lien est son événement le plus récent ; l'historique complet reste
--    lisible même si le lien est ensuite retiré ou si l'Engagement change de
--    statut (actif → completed/archived).

ALTER TABLE public.site_action_engagement_links
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.site_action_engagement_links
  DROP CONSTRAINT IF EXISTS site_action_engagement_links_unique;

CREATE UNIQUE INDEX IF NOT EXISTS site_action_engagement_links_active_unique
  ON public.site_action_engagement_links (site_action_id, engagement_id)
  WHERE removed_at IS NULL;

COMMENT ON COLUMN public.site_action_engagement_links.removed_at IS
  'P0-4C : fermeture logique du rapprochement (jamais de DELETE) — préserve l''historique des qualifications.';
COMMENT ON COLUMN public.site_action_engagement_links.removed_by IS 'Auteur humain du retrait.';

CREATE TABLE IF NOT EXISTS public.site_action_engagement_link_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  link_id          uuid NOT NULL REFERENCES public.site_action_engagement_links(id) ON DELETE CASCADE,

  qualification    text NOT NULL,
  note             text,

  created_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT site_action_engagement_link_events_qualification_check
    CHECK (qualification IN ('demande_evolution', 'mise_en_oeuvre', 'ecart_a_examiner', 'clarification')),
  CONSTRAINT site_action_engagement_link_events_note_length_check
    CHECK (note IS NULL OR char_length(note) <= 1000)
);

CREATE INDEX IF NOT EXISTS saele_link_idx ON public.site_action_engagement_link_events (link_id, created_at);

COMMENT ON TABLE public.site_action_engagement_link_events IS
  'P0-4C : qualification humaine append-only du lien Action↔Engagement. Répond à "pourquoi ce lien ?", jamais à "est-ce conforme ?". Aucun UPDATE : une correction est une nouvelle ligne ; la qualification courante = événement le plus récent.';
COMMENT ON COLUMN public.site_action_engagement_link_events.qualification IS
  'Une des 4 valeurs V1 : demande_evolution, mise_en_oeuvre, ecart_a_examiner, clarification. Ne jamais introduire conforme/non_conforme/ecart_confirme sans nouveau GO.';

ALTER TABLE public.site_action_engagement_link_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.site_action_engagement_link_events
  FOR ALL USING (auth.role() = 'service_role');
