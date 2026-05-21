'use server'

// Sprint D' — Server actions PUBLIQUES sur /h/[token].
//
// Vincent 2026-05-22. Pas d'authentification utilisateur — le token de partage
// est lui-même la preuve de droit d'usage. Le token vaut clé.
//
// Pattern aligné sur recordShareAccess (déjà public) : on s'appuie sur le
// token pour autoriser, on vérifie son état (non révoqué, non expiré, non
// archivé), on agit.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHandoverBriefByToken } from '@/lib/db/handover'
import { logAuditEvent } from '@/lib/audit/log'

const tokenSchema = z.object({
  token: z.string().min(8).max(128),
})

export interface PublicMutateResult {
  ok: boolean
  error?: string
}

/**
 * Bascule un brief en 'acknowledged' via son token de partage public.
 *
 * Le geste est traçable mais anonyme côté MemorIA (on ne sait pas QUI a
 * cliqué, juste que le détenteur du lien a confirmé lecture). Côté admin,
 * le brief montre maintenant l'état "Reconnu" + horodatage.
 *
 * Si le brief est expiré / archivé / déjà reconnu, on retourne ok=true
 * idempotent (pas d'erreur affichée à Joseph qui aurait rafraîchi).
 */
export async function acknowledgeBriefByTokenAction(input: {
  token: string
}): Promise<PublicMutateResult> {
  const parsed = tokenSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Token invalide' }
  }

  const brief = await getHandoverBriefByToken(parsed.data.token)
  if (!brief) return { ok: false, error: 'Lien introuvable' }
  if (brief.deleted_at || brief.status === 'archived') {
    return { ok: false, error: 'Brief archivé' }
  }
  if (brief.expires_at && new Date(brief.expires_at) < new Date()) {
    return { ok: false, error: 'Lien expiré' }
  }
  if (brief.status === 'acknowledged') {
    // Idempotent — déjà reconnu
    return { ok: true }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('handover_briefs')
    .update({
      status: 'acknowledged',
      // acknowledged_by reste NULL — c'est un acknowledgment public anonyme
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', brief.id)
    .neq('status', 'archived')
  if (error) {
    return { ok: false, error: error.message }
  }

  // Audit log : trace l'événement sans identifier l'utilisateur public
  await logAuditEvent({
    userId: null,
    entityType: 'site',
    entityId: brief.id,
    action: 'updated',
    metadata: {
      kind: 'handover_brief_acknowledged_public',
      brief_id: brief.id,
      via_token: true,
    },
  })

  revalidatePath(`/h/${parsed.data.token}`)
  revalidatePath(`/handovers/${brief.id}`)
  revalidatePath('/handovers')
  return { ok: true }
}
