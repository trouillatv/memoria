'use client'

import { usePhotoUploader } from '@/lib/field/use-photo-uploader'

/**
 * V5.1 (2026-05-14) — Drainer global de la queue IndexedDB sur toute la zone
 * field. Monte le hook usePhotoUploader pour que la queue se draine peu
 * importe la page field consultée (pas seulement sur /m/intervention/[id]
 * comme avant Slice 1).
 *
 * Le hook continue d'exister localement dans checklist-mobile.tsx pour
 * minimiser les régressions sur le flow legacy. Les deux instances cohabitent
 * sans risque : isUploadingRef est local par instance, et la queue est
 * idempotente (chaque upload OK fait removeQueuedPhoto qui est visible
 * globalement). Au pire un double-pass inefficace mais inoffensif.
 *
 * Ce composant ne rend rien : sa seule responsabilité est de tenir le hook
 * monté tant que l'utilisateur est dans la zone field.
 */
export function FieldSyncDrainer() {
  usePhotoUploader()
  return null
}
