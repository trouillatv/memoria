-- 075 — Feedback in-app
--
-- Vincent 2026-05-21 : bouton flottant sur le dashboard. L'utilisateur tape
-- un message court → atterrit ici → visible côté admin sur /admin/feedback
-- avec statuts open / done / spam.
--
-- Doctrine : pas de mail, pas de Slack, pas d'outil tiers. Tout reste dans
-- MemorIA. Pas de DELETE en RLS : audit trail (purge éventuelle service-role).
--
-- Tracking croisé : chaque création de feedback déclenche aussi un
-- `logAuditEvent({entityType:'feedback', action:'created'})` côté Server
-- Action, qui s'affiche dans le monitoring existant (cf. /admin/monitoring).

CREATE TABLE IF NOT EXISTS public.feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message     text NOT NULL CHECK (length(trim(message)) > 0 AND length(message) <= 2000),
  page        text,
  user_agent  text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'spam')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_status_created_idx
  ON public.feedback(status, created_at DESC);

CREATE INDEX IF NOT EXISTS feedback_user_idx
  ON public.feedback(user_id);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Insert : tout utilisateur authentifié peut poster SON PROPRE feedback.
CREATE POLICY "Authenticated insert own feedback"
  ON public.feedback FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- Read : admin uniquement. Manager exclu pour préserver la confidentialité
-- (un agent qui râle sur son manager dans le feedback ne doit pas être lu
-- par ce manager).
CREATE POLICY "Admin read all feedback"
  ON public.feedback FOR SELECT
  USING (public.current_user_role() = 'admin');

-- Update : admin uniquement (changer le statut open/done/spam).
CREATE POLICY "Admin update feedback status"
  ON public.feedback FOR UPDATE
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Pas de DELETE : audit trail. Si purge nécessaire, passer par service-role.

COMMENT ON TABLE public.feedback IS
  'Feedback in-app (Vincent 2026-05-21). RLS : self insert ; admin read/update ; pas de delete.';
