-- Preuve d'exécution externe via /i/[token] (2026-06-15)
--
-- Le lien externe n'est plus « j'atteste » mais « je prouve ce que j'ai fait » :
-- checklist + photos + note + signature manuscrite, depuis le téléphone.
--
-- Doctrine : l'externe ATTESTE et PROUVE, il ne CLÔTURE jamais l'intervention
-- opérationnelle. La signature/les photos externes sont une preuve parallèle,
-- elles ne changent pas le statut de l'intervention.

-- ── Signature manuscrite de l'externe (sur le TOKEN, signataire ≠ équipe) ───
-- Base64 PNG data URL (5-25 Ko), même pattern que interventions.signature_data_url.
ALTER TABLE public.intervention_tokens
  ADD COLUMN IF NOT EXISTS signature_data_url text,
  ADD COLUMN IF NOT EXISTS signed_at          timestamptz;

COMMENT ON COLUMN public.intervention_tokens.signature_data_url IS
  'Signature manuscrite de l''intervenant externe (base64 PNG). Preuve, jamais clôture.';

-- ── Photos déposées par l'externe via le lien ──────────────────────────────
-- Rattachées à l'intervention (visibles dans sa galerie) ET au token (pour
-- compter « photos externes » par intervenant). taken_by reste NULL (pas de user).
ALTER TABLE public.intervention_photos
  ADD COLUMN IF NOT EXISTS external_token_id uuid REFERENCES public.intervention_tokens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS iphoto_external_token_idx
  ON public.intervention_photos (external_token_id) WHERE external_token_id IS NOT NULL;

COMMENT ON COLUMN public.intervention_photos.external_token_id IS
  'Si renseigné : photo déposée par un intervenant externe via /i/[token]. taken_by reste NULL.';
