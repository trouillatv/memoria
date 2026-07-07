'use client'

import { useEffect, useRef } from 'react'
import { ensureCrMapSnapshotAction } from './map-snapshot-actions'

/**
 * Déclenche, en fond et une seule fois, la fabrication de l'instantané carte du
 * CR quand l'utilisateur ouvre l'aperçu (moment où MemorIA « connaît » déjà la
 * carte). Ne bloque rien, n'affiche rien : le PDF réutilisera l'image produite.
 * Si ça échoue, le PDF retombera sur le schéma métrique — aucun impact visible.
 */
export function CrMapSnapshotTrigger({ reportId }: { reportId: string }) {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    ensureCrMapSnapshotAction(reportId).catch(() => {})
  }, [reportId])
  return null
}
