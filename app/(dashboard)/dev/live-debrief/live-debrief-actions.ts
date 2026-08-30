'use server'

import { getCurrentUserWithProfile } from '@/lib/db/users'
import { markLiveDebriefSignalSeen, type LiveDebriefInformationalItem } from '@/lib/knowledge/live-debrief'

// ── Auth (miroir de requireOperator dans site-brief-actions.ts) ────────────

async function requireOperator(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe') {
    return { ok: false, error: 'Accès refusé' }
  }
  return { ok: true, userId: user.id }
}

/**
 * Passe par markLiveDebriefSignalSeen — seul point d'entrée D3 §3. Le
 * type-lock sur `LiveDebriefInformationalItem` traverse la frontière
 * client/serveur : impossible d'appeler ceci avec un item Action/Échéance/
 * Réserve, à la compilation.
 */
export async function markLiveDebriefSignalSeenAction(
  item: LiveDebriefInformationalItem,
  siteId: string,
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireOperator()
  if (!auth.ok) return { ok: false, error: auth.error }
  await markLiveDebriefSignalSeen(item, siteId, auth.userId)
  return { ok: true }
}
