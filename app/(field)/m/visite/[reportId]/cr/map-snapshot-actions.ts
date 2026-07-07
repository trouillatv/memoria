'use server'

import { requireFieldAgent } from '@/lib/field/auth'
import { ensureCrMapSnapshot } from '@/lib/pdf/cr-map-snapshot'

/**
 * Produit (une seule fois) l'instantané carte du CR. Déclenché en fond à
 * l'ouverture de l'aperçu — jamais au moment de générer le PDF. Silencieux :
 * un échec (réseau, tuiles indispo) laisse simplement le PDF en schéma métrique.
 */
export async function ensureCrMapSnapshotAction(reportId: string): Promise<{ ok: boolean }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false }
  try {
    const path = await ensureCrMapSnapshot(reportId)
    return { ok: !!path }
  } catch {
    return { ok: false }
  }
}
