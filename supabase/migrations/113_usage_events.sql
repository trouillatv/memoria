-- Usage produit — instrumentation légère pour le test terrain (2026-06-16)
--
-- ⚠️ Table DÉDIÉE à l'usage produit, ≠ audit sécurité. NE PAS confondre avec
-- public.activity_logs (journal d'audit, traçabilité opposable). Ici on répond
-- à 3 questions après une semaine de test terrain :
--   1. Quels briefs sont ouverts ? (prepare_visit_opened / prepare_meeting_opened)
--   2. Que cherchent les gens ?     (memory_search → meta.query)
--   3. Ouvrir un brief mène-t-il à une action réelle ? (action_created)
--
-- Best-effort : l'écriture ne doit jamais bloquer l'UX. Pas de RLS — accès
-- applicatif via l'admin client (service role), comme les autres tables site_*
-- (cf. lib/db/site-actions.ts). Pas de FK contraignante hormis user_id.

CREATE TABLE IF NOT EXISTS public.usage_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event           text NOT NULL,         -- prepare_visit_opened | prepare_meeting_opened | memory_search | action_created
  site_id         uuid,
  user_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  organization_id uuid,
  meta            jsonb,                  -- { query, ... }
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_event_created_idx ON public.usage_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_org_created_idx   ON public.usage_events (organization_id, created_at DESC);
