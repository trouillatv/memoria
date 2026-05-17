-- Migration 066 : lien FK entre une photo d'intervention et une anomalie.
-- Permet à un agent de rattacher une photo à une anomalie existante,
-- renforçant la défendabilité du dossier (Phase 1 — Substrat de preuve).
ALTER TABLE public.intervention_photos
  ADD COLUMN IF NOT EXISTS anomaly_id UUID
    REFERENCES public.intervention_anomalies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS intervention_photos_anomaly_id_idx
  ON public.intervention_photos(anomaly_id)
  WHERE anomaly_id IS NOT NULL;
