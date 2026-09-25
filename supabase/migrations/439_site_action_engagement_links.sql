-- ============================================================
-- 439 — Lien explicite Action ↔ Engagement (P0-4B, GO Vincent 2026-09-25)
-- ============================================================
-- Doctrine : « Engagement = ce qui doit être vrai. Action = quelque chose
-- qu'il faut traiter. » Ce lien signifie UNIQUEMENT « un humain considère que
-- cette Action concerne cet Engagement ». Il ne signifie JAMAIS : conformité,
-- non-conformité, écart, demande contractuelle acceptée, ou modification de
-- l'Engagement. Table additive, FK réelles, aucune relation polymorphe.
--
-- Les invariants d'écriture (Porte A/B, statut actif, même organisation) sont
-- vérifiés côté application (lib/db/site-action-engagement-links.ts), jamais
-- en confiance depuis le client — cf. lib/auth/site-write-access.ts (M2C).
--
-- Un lien déjà créé reste lisible même si l'Engagement change ensuite de
-- statut (actif → completed/archived) : le filtre "actif" ne s'applique
-- qu'à la création d'un NOUVEAU lien, jamais à la lecture d'un lien existant.

CREATE TABLE IF NOT EXISTS public.site_action_engagement_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id          uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,

  site_action_id   uuid NOT NULL REFERENCES public.site_actions(id) ON DELETE CASCADE,
  engagement_id    uuid NOT NULL REFERENCES public.engagements(id) ON DELETE CASCADE,

  created_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT site_action_engagement_links_unique UNIQUE (site_action_id, engagement_id)
);

CREATE INDEX IF NOT EXISTS saeli_action_idx ON public.site_action_engagement_links (site_action_id);
CREATE INDEX IF NOT EXISTS saeli_engagement_idx ON public.site_action_engagement_links (engagement_id);
CREATE INDEX IF NOT EXISTS saeli_site_idx ON public.site_action_engagement_links (site_id);

COMMENT ON TABLE public.site_action_engagement_links IS
  'P0-4B : rapprochement humain Action ↔ Engagement. Signifie UNIQUEMENT "un humain considère que cette Action concerne cet Engagement" — jamais conformité/écart/modification de l''Engagement. Un lien historique reste lisible même après changement de statut de l''Engagement.';
COMMENT ON COLUMN public.site_action_engagement_links.site_action_id IS 'L''Action rapprochée.';
COMMENT ON COLUMN public.site_action_engagement_links.engagement_id IS 'L''Engagement de référence désigné par un humain.';
COMMENT ON COLUMN public.site_action_engagement_links.created_by IS 'Auteur humain du rapprochement (jamais une suggestion IA en V1).';

ALTER TABLE public.site_action_engagement_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.site_action_engagement_links
  FOR ALL USING (auth.role() = 'service_role');
