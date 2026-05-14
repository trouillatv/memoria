-- Migration 050 — Ajout presentation_kind à proof_share_tokens (Sprint V5.1).
--
-- Décision Vincent 2026-05-14 : la capsule WhatsApp n'est PAS une nouvelle
-- entité de partage. C'est un RENDU différent d'un proof_share_token existant.
--
-- Architecture validée :
--   - Capsule mensuelle = proof_share_token avec
--       contract_id + report_month (pattern hérité de migration 026)
--       + presentation_kind='monthly_capsule'
--       + selected_photo_ids = [1 photo]
--       + dg_note = phrase descriptive templatée
--   - Capsule incident résolu = proof_share_token avec
--       intervention_id
--       + presentation_kind='incident_capsule'
--       + selected_photo_ids = [photo_avant, photo_apres]
--       + dg_note = phrase descriptive templatée
--   - Dossier de preuves legacy = proof_share_token avec
--       presentation_kind='proof_dossier' (DEFAULT — rétrocompatible)
--
-- Routes publiques :
--   /p/[token] = rendu legacy (dossier preuves + rapport mensuel)
--   /c/[token] = rendu capsule (fond noir, 3 éléments, screenshotable iPhone)
-- La route choisie par le code dépend du presentation_kind.
--
-- ───────────────────────────────────────────────────────────────────────────
-- GARDE-FOU DOCTRINAL (Vincent 2026-05-14) :
--   presentation_kind ne doit PAS devenir un fourre-tout marketing.
--   Chaque nouvelle valeur future doit répondre OUI à :
--     « Est-ce un rendu public d'une preuve ou d'une mémoire existante ? »
--   Si oui : extension autorisée.
--   Si c'est une nouvelle expérience commerciale autonome : refuser
--   l'extension et créer un autre objet.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.proof_share_tokens
  ADD COLUMN presentation_kind text NOT NULL DEFAULT 'proof_dossier'
  CHECK (presentation_kind IN ('proof_dossier', 'monthly_capsule', 'incident_capsule'));

-- Index partial pour la route publique /c/[token] (lookups capsules actives).
-- Cohérent avec idx_proof_share_tokens_token (migration 022) qui filtre déjà
-- where revoked_at is null.
CREATE INDEX IF NOT EXISTS idx_proof_share_tokens_capsule
  ON public.proof_share_tokens(presentation_kind, expires_at)
  WHERE presentation_kind IN ('monthly_capsule', 'incident_capsule')
    AND revoked_at IS NULL;

COMMENT ON COLUMN public.proof_share_tokens.presentation_kind IS
  'V5.1 (2026-05-14) — Mode de rendu du share token. ''proof_dossier'' (default, legacy) = route /p/[token] pour dossier preuves ou rapport mensuel. ''monthly_capsule'' + ''incident_capsule'' = route /c/[token] pour rendu capsule WhatsApp. Garde-fou doctrinal : ne pas étendre cette enum sans répondre OUI à « est-ce un rendu d''une preuve/mémoire existante ? ».';
