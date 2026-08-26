'use server'

import { requireFieldAgent } from '@/lib/field/auth'
import { ensureCrMapSnapshot, setCrMapBaseLayer, getCrMapBaseLayerStatus, type CrMapBaseLayerStatus } from '@/lib/pdf/cr-map-snapshot'
import type { MapBaseLayerId } from '@/lib/field/map-base-layers'

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

/**
 * Enregistre le choix explicite du fond de carte DU PDF pour ce rapport, puis
 * régénère l'instantané avant de renvoyer. Contrairement à
 * `ensureCrMapSnapshotAction` (fire-and-forget, silencieux), cette action est
 * déclenchée par un geste explicite de l'utilisateur (tap sur le contrôle) —
 * elle attend la régénération et renvoie un état réel, jamais un succès
 * supposé (Vincent, Lot Carte PDF Plan/Satellite, 2026-08-26).
 */
export async function setCrMapBaseLayerAction(
  reportId: string,
  layer: MapBaseLayerId,
): Promise<CrMapBaseLayerStatus & { ok: boolean }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) {
    return { ok: false, chosen: 'plan', explicit: false, snapshotLayer: null, snapshotPath: null, satelliteAvailable: false }
  }
  try {
    await setCrMapBaseLayer(reportId, layer)
    await ensureCrMapSnapshot(reportId)
  } catch {
    // On retombe sur l'état réel lu en base ci-dessous — jamais un succès simulé.
  }
  const status = await getCrMapBaseLayerStatus(reportId)
  return { ok: true, ...status }
}
