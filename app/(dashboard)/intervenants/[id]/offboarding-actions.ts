'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile, softDeleteUserAsAdmin } from '@/lib/db/users'
import { logAuditEvent } from '@/lib/audit/log'

/**
 * Désactivation d'un intervenant — dernière étape du parcours d'offboarding
 * guidé (Vincent 2026-05-27). Soft delete (deleted_at) : la personne disparaît
 * des listes, mais sa mémoire déposée (traces, photos, briefs) reste — artefact
 * jamais supprimé. RÉSERVÉ ADMIN (cohérent avec /admin/users).
 */
export async function deactivateIntervenantAction(input: {
  userId: string
}): Promise<{ ok: boolean; error?: string }> {
  const viewer = await getCurrentUserWithProfile()
  if (!viewer) return { ok: false, error: 'Non authentifié.' }
  if (viewer.role !== 'admin') {
    return { ok: false, error: 'Désactivation réservée à un administrateur.' }
  }
  if (viewer.id === input.userId) {
    return { ok: false, error: 'Vous ne pouvez pas vous désactiver vous-même.' }
  }
  const parsed = z.object({ userId: z.string().uuid() }).safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Identifiant invalide.' }

  try {
    await softDeleteUserAsAdmin(parsed.data.userId)
    await logAuditEvent({
      userId: viewer.id,
      entityType: 'user',
      entityId: parsed.data.userId,
      action: 'soft_deleted',
      metadata: { kind: 'offboarding_deactivate' },
    })
    revalidatePath('/intervenants')
    revalidatePath('/admin/users')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec de la désactivation.' }
  }
}
