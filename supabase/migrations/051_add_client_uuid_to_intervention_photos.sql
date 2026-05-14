-- Migration 051 — Idempotence du sync offline-first (Sprint V5.1, Slice 1).
--
-- Décision Vincent 2026-05-14 (après audit) : ajout d'un client_uuid pour
-- garantir l'idempotence du dépôt photo offline-first. Sans ça, un retry
-- réseau lent ou un Service Worker hyperactif peut créer N doublons pour
-- une seule prise photo de Joseph — y compris N anomalies dupliquées dans
-- la mémoire du lieu.
--
-- Pattern d'usage côté code (Slice 1) :
--   1. À la prise photo, le client génère un UUID v4 et le persiste en
--      IndexedDB queue avec le blob photo.
--   2. Le Service Worker POST /api/m/traces/sync avec { client_uuid, ... }.
--   3. L'endpoint serveur fait INSERT ... ON CONFLICT (client_uuid) DO NOTHING.
--   4. Si un retry arrive après que la première a été commitée → no-op
--      silencieux, idempotent.
--
-- Colonne NULLABLE et INDEX PARTIAL :
--   - NULL pour toutes les photos legacy pré-V5.1 (rétrocompatible)
--   - UNIQUE seulement sur les non-NULL (pas de coût legacy)
--   - Pas de backfill : le legacy reste tel quel.
--
-- Note : ne pas confondre avec sha256 (intégrité du fichier binaire serveur)
-- ni avec id (clé primaire serveur). client_uuid = identité de l'événement
-- côté terminal Joseph, persistée à travers les retries.

ALTER TABLE public.intervention_photos
  ADD COLUMN client_uuid uuid;

CREATE UNIQUE INDEX IF NOT EXISTS intervention_photos_client_uuid_idx
  ON public.intervention_photos(client_uuid)
  WHERE client_uuid IS NOT NULL;

COMMENT ON COLUMN public.intervention_photos.client_uuid IS
  'V5.1 (Slice 1, dépôt offline-first). UUID v4 généré côté client à la prise photo, persisté en IndexedDB. Permet INSERT ... ON CONFLICT (client_uuid) DO NOTHING côté endpoint /api/m/traces/sync. NULL pour photos legacy pré-V5.1.';
