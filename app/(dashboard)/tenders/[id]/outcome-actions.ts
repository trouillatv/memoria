'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import { setTenderOutcome } from '@/lib/db/tenders'
import { logAuditEvent } from '@/lib/audit/log'

/**
 * Doctrine V5 verrou V1 : la mémoire ≠ recommandation.
 * Guillaume déclare un fait. Le système l'enregistre.
 * Aucune relance, aucun score, aucune suggestion d'action.
 */

async function requireManagerOrAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') return { error: 'Forbidden' }
  return { userId: user.id }
}

const Schema = z.object({
  tenderId: z.string().uuid(),
  outcome: z.enum(['pending', 'won', 'lost', 'withdrawn', 'not_responded']),
  reason: z.string().max(200).optional(),
  tag: z.enum(['prix', 'qualite', 'relation', 'timing', 'autre']).optional(),
})

export async function setTenderOutcomeAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = Schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' }
  }

  try {
    await setTenderOutcome({
      tenderId: parsed.data.tenderId,
      outcome: parsed.data.outcome,
      reason: parsed.data.reason,
      tag: parsed.data.tag,
      userId: auth.userId,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error'
    return { ok: false, error: msg }
  }

  // Audit log best-effort — fait posé, jamais évaluation.
  try {
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'tender',
      entityId: parsed.data.tenderId,
      action: 'status_changed',
      metadata: {
        outcome: parsed.data.outcome,
        has_reason: !!parsed.data.reason,
        tag: parsed.data.tag ?? null,
      },
    })
  } catch {
    // best-effort, on ne casse pas le flow métier
  }

  revalidatePath(`/tenders/${parsed.data.tenderId}`)
  return { ok: true }
}
