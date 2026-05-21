'use server'

// Sprint D — Mémoire qui sait vieillir (Vincent 2026-05-22).
//
// Server action pour résoudre une anomalie depuis un brief de passage de
// témoin. Permet au manager d'agir AU MOMENT où il revoit la mémoire
// transmise — c'est la doctrine [[lien-utile-aide-a-agir]] appliquée au
// brief lui-même.
//
// Effet : l'anomalie bascule en status='resolved' avec resolved_at,
// resolved_by, resolution_note. Dans les briefs futurs, elle n'apparaîtra
// plus (filtre status='open' dans buildSiteContextEntry).
//
// IMPORTANT : on ne modifie PAS le snapshot du brief courant (immuable).
// On marque l'anomalie côté DB ; le brief actuel continue d'afficher la
// liste capturée au moment T. Les briefs FUTURS bénéficient du filtrage.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
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

const resolveSchema = z.object({
  anomalyId: z.string().uuid(),
  note: z.string().max(500).optional(),
})

export interface ResolveAnomalyResult {
  ok: boolean
  error?: string
}

export async function resolveAnomalyAction(input: {
  anomalyId: string
  note?: string
}): Promise<ResolveAnomalyResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = resolveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('intervention_anomalies')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolved_by: auth.userId,
      resolution_note: parsed.data.note?.trim() || null,
    })
    .eq('id', parsed.data.anomalyId)
    .eq('status', 'open') // ne re-résout pas une anomalie déjà résolue/ignorée

  if (error) {
    return { ok: false, error: error.message }
  }

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'site',
    entityId: parsed.data.anomalyId,
    action: 'updated',
    metadata: {
      kind: 'anomaly_resolved',
      anomaly_id: parsed.data.anomalyId,
      has_note: !!parsed.data.note,
    },
  })

  // Revalide les pages qui affichent des anomalies — large mais sûr
  revalidatePath('/handovers', 'layout')
  revalidatePath('/sites', 'layout')

  return { ok: true }
}

/**
 * Réouvre une anomalie résolue (geste rare mais utile en cas d'erreur).
 */
export async function reopenAnomalyAction(input: {
  anomalyId: string
}): Promise<ResolveAnomalyResult> {
  const auth = await requireManagerOrAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const parsed = z.object({ anomalyId: z.string().uuid() }).safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'ID invalide' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('intervention_anomalies')
    .update({
      status: 'open',
      resolved_at: null,
      resolved_by: null,
      resolution_note: null,
    })
    .eq('id', parsed.data.anomalyId)
    .neq('status', 'open')

  if (error) {
    return { ok: false, error: error.message }
  }

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'site',
    entityId: parsed.data.anomalyId,
    action: 'updated',
    metadata: { kind: 'anomaly_reopened', anomaly_id: parsed.data.anomalyId },
  })

  revalidatePath('/handovers', 'layout')
  revalidatePath('/sites', 'layout')

  return { ok: true }
}
