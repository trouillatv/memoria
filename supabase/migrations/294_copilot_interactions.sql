-- 294 — Table copilot_interactions : télémétrie Copilote Phase 2/3/3C.
--
-- Objectif : observer chaque échange du Copilote en phase pilote.
-- Doctrine :
--   - append-only après insert (sauf proposal_status et reference_clicks)
--   - answer_text stocké pour le drawer admin uniquement (extrait en lecture)
--   - user_id présent (observatoire pilote) — distinct de usage_events (anonyme)
--   - cloisonné par organization_id, service_role en écriture
--   - rétention cible : 12 mois glissants (purge à planifier)
--
-- conversation_id : UUID généré côté client une fois par session (conversation),
--   transmis à chaque échange → regroupe Question → relance → proposition sans
--   persister tout l'historique dans chaque ligne.
--
-- Rollback : DROP TABLE + DROP INDEX.

CREATE TABLE IF NOT EXISTS public.copilot_interactions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  site_id               uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  user_id               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  conversation_id       uuid,          -- session côté client, nullable si non fourni
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- Demande
  question              text NOT NULL,
  conversation_mode     text NOT NULL DEFAULT 'free'
                          CONSTRAINT copilot_conv_mode_chk CHECK (
                            conversation_mode IN ('guided', 'free')
                          ),
  guided_intent         text          -- 'attention' | 'changes' | 'stale' | 'next_visit'
                          CONSTRAINT copilot_guided_intent_chk CHECK (
                            guided_intent IS NULL OR guided_intent IN (
                              'attention', 'changes', 'stale', 'next_visit'
                            )
                          ),

  -- Compréhension déterministe du routeur
  primary_intent        text,
  secondary_intents     text[] NOT NULL DEFAULT '{}',
  scope                 text NOT NULL DEFAULT 'unknown'
                          CONSTRAINT copilot_scope_chk CHECK (
                            scope IN (
                              'site', 'canonical_subject', 'action', 'actor',
                              'visit', 'meeting', 'historical_pv', 'report',
                              'visit_plan', 'dependencies', 'unknown'
                            )
                          ),
  resolved_subject_ids  uuid[] NOT NULL DEFAULT '{}',

  -- Réponse
  answer_text           text,          -- texte complet retourné à l'utilisateur
  answer_mode           text
                          CONSTRAINT copilot_answer_mode_chk CHECK (
                            answer_mode IS NULL OR answer_mode IN (
                              'llm', 'deterministic_fallback', 'clarification'
                            )
                          ),
  answer_status         text
                          CONSTRAINT copilot_answer_status_chk CHECK (
                            answer_status IS NULL OR answer_status IN (
                              'answered', 'not_found', 'ambiguous',
                              'insufficient_data', 'provider_error'
                            )
                          ),
  cited_reference_count integer NOT NULL DEFAULT 0,
  sources_used          text[] NOT NULL DEFAULT '{}',

  -- Technique et coût
  model                 text,
  prompt_version        text,
  input_tokens          integer,
  output_tokens         integer,
  estimated_cost_eur    real,
  latency_ms            integer,
  used_fallback         boolean NOT NULL DEFAULT false,

  -- Proposition 3C
  proposal_kind         text
                          CONSTRAINT copilot_proposal_kind_chk CHECK (
                            proposal_kind IS NULL OR proposal_kind IN ('action', 'visit_item')
                          ),
  proposal_id           uuid,          -- copilot_proposal_id dans site_actions
  proposal_status       text DEFAULT 'none'
                          CONSTRAINT copilot_proposal_status_chk CHECK (
                            proposal_status IN ('none', 'shown', 'confirmed', 'cancelled')
                          ),

  -- Événements client légers (incrémentaux)
  reference_clicks      integer NOT NULL DEFAULT 0
);

-- Index lecture admin (par tenant + date)
CREATE INDEX IF NOT EXISTS copilot_interactions_org_date
  ON public.copilot_interactions (organization_id, created_at DESC);

-- Index lecture admin (par chantier)
CREATE INDEX IF NOT EXISTS copilot_interactions_site_date
  ON public.copilot_interactions (site_id, created_at DESC)
  WHERE site_id IS NOT NULL;

-- Index agrégation par scope + status
CREATE INDEX IF NOT EXISTS copilot_interactions_scope_status
  ON public.copilot_interactions (scope, answer_status, created_at DESC);

-- Index conversation (regroupe les échanges d'une session)
CREATE INDEX IF NOT EXISTS copilot_interactions_conversation
  ON public.copilot_interactions (conversation_id, created_at)
  WHERE conversation_id IS NOT NULL;

-- Index proposition (lien vers site_actions)
CREATE INDEX IF NOT EXISTS copilot_interactions_proposal
  ON public.copilot_interactions (proposal_id)
  WHERE proposal_id IS NOT NULL;

-- RLS : écriture service_role uniquement ; pas de SELECT policy publique.
-- La lecture admin passe par createAdminClient() (service_role bypass).
ALTER TABLE public.copilot_interactions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.copilot_interactions IS
  'Télémétrie Copilote Phase 2/3/3C (mig 294) — un échange par ligne, cloisonné par organization_id. answer_text stocké pour le drawer admin, extract ≤200 chars en vue liste. Rétention cible : 12 mois glissants.';

COMMENT ON COLUMN public.copilot_interactions.conversation_id IS
  'UUID généré côté client au démarrage d''une conversation. Regroupe Question → relance → proposition sans persister l''historique en base.';

COMMENT ON COLUMN public.copilot_interactions.answer_text IS
  'Texte complet retourné à l''utilisateur. Exposé UNIQUEMENT dans le drawer admin. Les vues liste utilisent LEFT(answer_text, 150).';

COMMENT ON COLUMN public.copilot_interactions.reference_clicks IS
  'Compteur incrémental côté client. Best-effort, peut rester à 0 si l''appel échoue.';

-- Fonction RPC : incrément atomique (pas de race condition sur le compteur).
CREATE OR REPLACE FUNCTION public.copilot_increment_reference_click(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.copilot_interactions
  SET reference_clicks = reference_clicks + 1
  WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.copilot_increment_reference_click(uuid) TO service_role;
