// Sprint E — Kill switch + accès à la page /continuite.
// Vincent 2026-05-22.
//
// Pattern identique à lib/intervenants/access.ts : permet de fermer la
// feature en 1 minute si Guillaume signale un malaise sur le pilote.

import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import type { DbUser } from '@/types/db'

export interface ContinuityAccess {
  viewer: DbUser
}

/**
 * Vérifie l'accès à /continuite (et au widget dashboard).
 * - ENV `CONTINUITY_PAGE_ENABLED` doit être 'true' (kill switch)
 * - Role doit être admin ou manager
 * - chef_equipe → redirect /m
 */
export async function checkContinuityAccess(): Promise<ContinuityAccess> {
  const enabled = process.env.CONTINUITY_PAGE_ENABLED === 'true'
  if (!enabled) {
    // 404 propre — la feature n'existe pas pour les non-allowlistés
    const { notFound } = await import('next/navigation')
    notFound()
  }

  const viewer = await getCurrentUserWithProfile()
  if (!viewer) redirect('/login')
  if (viewer.role === 'chef_equipe') redirect('/m')
  if (viewer.role !== 'admin' && viewer.role !== 'manager') {
    // belt + suspenders
    redirect('/dashboard')
  }

  return { viewer }
}

/**
 * Indique si la feature est activée — pour conditionner l'affichage du
 * widget dashboard sans lever d'erreur si OFF.
 */
export function isContinuityFeatureEnabled(): boolean {
  return process.env.CONTINUITY_PAGE_ENABLED === 'true'
}
