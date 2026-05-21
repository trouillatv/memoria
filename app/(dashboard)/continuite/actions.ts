'use server'

// Sprint E — Server actions pour la continuité de mémoire anticipée.
// Vincent 2026-05-22.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { updateContractEndDate } from '@/lib/db/continuity'
import { logAuditEvent } from '@/lib/audit/log'

type AuthOk = { userId: string }
type AuthFail = { error: string }

async function requireManagerOrAdmin(): Promise<AuthOk | AuthFail> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') return { error: 'Accès refusé' }
  return { userId: user.id }
}

const updateSchema = z.object({
  targetUserId: z.string().uuid(),
  // Date YYYY-MM-DD ou null pour effacer
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
})

export interface MutateResult {
  ok: boolean
  error?: string
}

/**
 * Met à jour (ou efface) la date de fin de contrat d'une personne.
 *
 * Doctrine : le geste est administratif (saisie d'un fait), pas RH.
 * Auditée systématiquement.
 */
export async function updateContractEndDateAction(input: {
  targetUserId: string
  date: string | null
}): Promise<MutateResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  try {
    await updateContractEndDate(parsed.data.targetUserId, parsed.data.date)
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'user',
      entityId: parsed.data.targetUserId,
      action: 'updated',
      metadata: {
        kind: 'contract_end_date_changed',
        new_date: parsed.data.date,
      },
    })
    revalidatePath('/continuite')
    revalidatePath(`/intervenants/${parsed.data.targetUserId}`)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur'
    return { ok: false, error: msg }
  }
}
