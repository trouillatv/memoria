-- 339 — Table copilot_decompose_shadow : télémétrie P6-A2 (shadow mode).
--
-- Objectif : observer decompose-v2 (`lib/visits/copilot-decompose.ts`, P6-A1)
-- sur de VRAIS tours Copilote, sans aucun effet sur le pipeline réel — aucune
-- carte, aucune écriture, aucun changement de `whichIntent()`. Mandat Vincent
-- P6-A2 (2026-08-17).
--
-- Doctrine :
--   - append-only, jamais lu par le pipeline Copilote réel
--   - PAS de FK vers copilot_interactions.id : le probe est planifié via
--     `after()` avant que la branche réelle n'insère sa propre ligne (qui
--     peut ne jamais exister pour un tour en erreur) — le rapprochement se
--     fait par conversation_id + fenêtre temporelle, jamais par clé stricte.
--   - question dupliquée ICI en connaissance de cause (pas de FK propre
--     disponible à l'instant du planning) — isolé de copilot_interactions,
--     donc AUCUNE pollution de l'Observatoire ni du pattern-mining réel.
--   - cloisonné par organization_id, service_role en écriture/lecture
--   - table jetable : purge ou DROP possible sans impact produit
--
-- Rollback : DROP TABLE public.copilot_decompose_shadow.

CREATE TABLE IF NOT EXISTS public.copilot_decompose_shadow (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  site_id               uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  user_id               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  conversation_id       uuid,          -- lien vers le même tour Copilote, best-effort
  created_at            timestamptz NOT NULL DEFAULT now(),

  question              text NOT NULL,
  decompose_version     text NOT NULL, -- ex. 'decompose-v2'

  segment_count         integer NOT NULL,
  ambiguous             boolean NOT NULL,
  used_fallback         boolean NOT NULL DEFAULT false,
  -- [{ start, end, text, dependsOn, intent, confidence, signals }]
  segments              jsonb NOT NULL DEFAULT '[]'::jsonb,

  latency_ms            integer,
  error                 text
);

CREATE INDEX IF NOT EXISTS copilot_decompose_shadow_org_date
  ON public.copilot_decompose_shadow (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS copilot_decompose_shadow_conversation
  ON public.copilot_decompose_shadow (conversation_id, created_at)
  WHERE conversation_id IS NOT NULL;

-- RLS : écriture/lecture service_role uniquement — aucune policy publique,
-- aucune surface client. Lecture via createAdminClient() uniquement.
ALTER TABLE public.copilot_decompose_shadow ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.copilot_decompose_shadow IS
  'Shadow mode P6-A2 (mig 339) : observation pure de decompose-v2 sur les vrais tours Copilote. Jamais lu par le pipeline réel, jamais présenté à l''utilisateur, jamais source de carte ou d''écriture. Purge/DROP libres.';
