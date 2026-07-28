-- Mémoire métier des mauvaises extractions (Vincent, 2026-07-28).
--
-- DOCTRINE : quand un utilisateur annule une échéance avec le motif
-- « Mauvaise extraction » et coche « Ne plus proposer », MemorIA enregistre
-- le pattern et masque les futures propositions similaires sur ce chantier.
-- Les propositions masquées ne sont JAMAIS supprimées silencieusement : elles
-- apparaissent dans une section « Masquées — à vérifier ».
--
-- Formule verrouillée (Vincent, 2026-07-28) :
--   score = overlap / |suppressionTokens|
--   déclenchement si : overlap ≥ 2 ET score ≥ 0.6 (DEFAULT_SUPPRESSION_THRESHOLD)
--
-- NO RLS (admin client comme les autres tables site_*).
-- organization_id présent dès maintenant pour le cloisonnement futur.

CREATE TABLE IF NOT EXISTS public.site_extraction_suppressions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  object_type     text NOT NULL CHECK (object_type IN ('deadline', 'action', 'decision')),
  -- Tokens normalisés stockés à la création : la correspondance est déterministe,
  -- sans ré-analyse du texte à chaque extraction.
  title_tokens    text[] NOT NULL,
  raw_title       text NOT NULL,
  cancel_reason   text NOT NULL,
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_extraction_suppressions_site_idx
  ON public.site_extraction_suppressions (site_id, object_type);

COMMENT ON TABLE public.site_extraction_suppressions IS
  'Patterns rejetés par un utilisateur (bad_extraction). Le moteur masque les futures propositions similaires plutôt que de les supprimer silencieusement.';
COMMENT ON COLUMN public.site_extraction_suppressions.title_tokens IS
  'Tokens normalisés (≥ 4 lettres, hors mots vides, doublons neutralisés). Stockés à la création pour éviter toute dérive de normalisation.';

-- Statut ''masked'' : proposition filtrée automatiquement par le moteur
-- de suppression. Consultable dans « Masquées — à vérifier », jamais invisible.
ALTER TABLE public.site_knowledge_proposals
  DROP CONSTRAINT IF EXISTS site_knowledge_proposals_status_check;
ALTER TABLE public.site_knowledge_proposals
  ADD CONSTRAINT site_knowledge_proposals_status_check
  CHECK (status IN ('proposed', 'confirmed', 'fulfilled', 'dismissed', 'superseded', 'masked'));

COMMENT ON COLUMN public.site_knowledge_proposals.status IS
  'proposed=à valider · confirmed=validée · fulfilled=satisfaite par CR · dismissed=rejetée · superseded=obsolète · masked=masquée par suppression (visible dans « Masquées — à vérifier »)';
