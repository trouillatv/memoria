'use server'

// Server actions pour les « actions ouvertes » (site_actions).
// Partagées par toutes les surfaces : fiche site, mobile site, briefing, /actions.
// Doctrine : une action n'est pas une intervention ; ici on ne fait que clôturer
// ou annuler. La planification (action → intervention) reste un geste séparé.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { markSiteActionDone, cancelSiteAction } from '@/lib/db/site-actions'

const IdSchema = z.string().uuid()

async function requireOperator(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe') {
    return { ok: false, error: 'Accès refusé' }
  }
  return { ok: true }
}

function revalidateActionSurfaces(siteId?: string) {
  revalidatePath('/actions')
  revalidatePath('/briefing')
  if (siteId) {
    revalidatePath(`/sites/${siteId}`)
    revalidatePath(`/m/site/${siteId}`)
  }
}

export async function markActionDoneAction(
  id: string,
  siteId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!IdSchema.safeParse(id).success) return { ok: false, error: 'Action invalide' }
  const auth = await requireOperator()
  if (!auth.ok) return auth
  try {
    await markSiteActionDone(id)
  } catch {
    return { ok: false, error: 'Échec de la mise à jour' }
  }
  revalidateActionSurfaces(siteId)
  return { ok: true }
}

export async function cancelActionAction(
  id: string,
  siteId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!IdSchema.safeParse(id).success) return { ok: false, error: 'Action invalide' }
  const auth = await requireOperator()
  if (!auth.ok) return auth
  try {
    await cancelSiteAction(id)
  } catch {
    return { ok: false, error: 'Échec de la mise à jour' }
  }
  revalidateActionSurfaces(siteId)
  return { ok: true }
}
