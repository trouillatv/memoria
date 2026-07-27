'use server'

// Photo principale d'un chantier (mig 243). Choix cosmétique mais site-scopé :
// on vérifie l'APPARTENANCE (requireOwned) — la couverture d'un chantier ne se
// change que par quelqu'un de son organisation.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { requireOwned } from '@/lib/auth/ownership'
import { setSiteCover } from '@/lib/db/site-cover'

const schema = z.object({
  siteId: z.string().uuid(),
  captureId: z.string().uuid().nullable(),
})

export async function setSiteCoverAction(
  input: z.input<typeof schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non autorisé' }
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const owned = await requireOwned(user.role, 'sites', parsed.data.siteId)
  if (!owned.allowed) return { ok: false, error: 'Accès refusé' }
  try {
    await setSiteCover(parsed.data.siteId, parsed.data.captureId)
    revalidatePath(`/m/site/${parsed.data.siteId}`)
    revalidatePath(`/sites/${parsed.data.siteId}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec de la mise à jour' }
  }
}
