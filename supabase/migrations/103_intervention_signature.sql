-- Migration 092 — Signature manuscrite sur intervention mobile
--
-- Le chef d'équipe signe avec le doigt sur son téléphone avant de clôturer
-- l'intervention. La signature est stockée en base64 PNG (data URL).
-- Taille typique : 5–25 Ko — acceptable en colonne text.
--
-- signed_by est nullable : la signature peut exister sans user_id dans des
-- scénarios de migration future. signed_at est toujours renseigné avec la signature.

ALTER TABLE public.interventions
  ADD COLUMN IF NOT EXISTS signature_data_url text,
  ADD COLUMN IF NOT EXISTS signed_at          timestamptz,
  ADD COLUMN IF NOT EXISTS signed_by          uuid REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.interventions.signature_data_url IS
  'Base64 PNG data URL de la signature manuscrite du chef d''équipe sur mobile.';
COMMENT ON COLUMN public.interventions.signed_at IS
  'Horodatage de la signature (serveur).';
COMMENT ON COLUMN public.interventions.signed_by IS
  'Utilisateur ayant signé (chef d''équipe ou manager).';
