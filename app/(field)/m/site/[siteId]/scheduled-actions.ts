'use server'

// Le moment PRÉVU (mig 216) — server actions du cycle complet :
// créer / modifier / reporter / annuler / démarrer / terminer.
//
// Ces actions ne sont que des ENVELOPPES d'authentification : le cycle vit dans
// lib/db/scheduled-events.ts, et le compte-rendu naît des créateurs existants
// (createVisit / createSiteReport). Aucun second mécanisme.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { requireOwned } from '@/lib/auth/ownership'
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createScheduledEvent, updateScheduledEvent, postponeScheduledEvent,
  cancelScheduledEvent, startScheduledEvent, completeScheduledEvent,
} from '@/lib/db/scheduled-events'

const TYPES = ['visit', 'meeting', 'inspection', 'delivery', 'other'] as const

const createSchema = z.object({
  site_id: z.string().uuid(),
  type: z.enum(TYPES),
  planned_start: z.string().datetime({ offset: true }),
  planned_end: z.string().datetime({ offset: true }).nullish(),
  title: z.string().trim().max(200).nullish(),
  // Le payload est validé par type dans parsePayload : on laisse passer l'objet
  // brut, la couche métier le ramène à la forme du type et jette le reste.
  payload: z.unknown().optional(),
})

/** Prévoir un moment. Le statut n'est jamais reçu du client : il naît `planned`. */
export async function createScheduledEventAction(
  input: z.input<typeof createSchema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const owned = await requireOwned(auth.role, 'sites', parsed.data.site_id)
  if (!owned.allowed) return { ok: false, error: owned.error ?? 'Accès refusé' }

  const res = await createScheduledEvent({
    siteId: parsed.data.site_id,
    type: parsed.data.type,
    plannedStart: parsed.data.planned_start,
    plannedEnd: parsed.data.planned_end ?? null,
    title: parsed.data.title ?? null,
    payload: parsed.data.payload,
    createdBy: auth.userId,
  })
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath(`/m/site/${parsed.data.site_id}`)
  return { ok: true, id: res.value }
}

const idSchema = z.object({ id: z.string().uuid(), site_id: z.string().uuid() })

type Guard =
  | { ok: false; error: string }
  | { ok: true; userId: string | null; data: { id: string; site_id: string }; orgId: string | null }

async function guard(input: unknown): Promise<Guard> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const owned = await requireOwned(auth.role, 'sites', parsed.data.site_id)
  if (!owned.allowed) return { ok: false, error: owned.error ?? 'Accès refusé' }
  const supabase = createAdminClient()
  const { data: site } = await supabase.from('sites').select('organization_id').eq('id', parsed.data.site_id).maybeSingle()
  if (!site || !site.organization_id) return { ok: false, error: 'Chantier introuvable' }
  const membership = await requireOrganizationMembership(site.organization_id)
  if (!membership.ok) return { ok: false, error: membership.error }
  return { ok: true, userId: auth.userId, data: parsed.data, orgId: site.organization_id }
}

const updateSchema = idSchema.extend({
  planned_start: z.string().datetime({ offset: true }).optional(),
  planned_end: z.string().datetime({ offset: true }).nullish(),
  title: z.string().trim().max(200).nullish(),
  payload: z.unknown().optional(),
})

export async function updateScheduledEventAction(
  input: z.input<typeof updateSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard(input)
  if (!g.ok) return { ok: false, error: g.error }
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const res = await updateScheduledEvent(
    parsed.data.id,
    {
      plannedStart: parsed.data.planned_start,
      ...(parsed.data.planned_end !== undefined ? { plannedEnd: parsed.data.planned_end } : {}),
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.payload !== undefined ? { payload: parsed.data.payload } : {}),
    },
    { userId: g.userId, orgId: g.orgId },
  )
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath(`/m/site/${parsed.data.site_id}`)
  return { ok: true }
}

const postponeSchema = idSchema.extend({
  planned_start: z.string().datetime({ offset: true }),
  planned_end: z.string().datetime({ offset: true }).nullish(),
  reason: z.string().trim().max(500).nullish(),
})

/** Reporter — l'ancienne date survit dans la trace. Reporté ≠ annulé. */
export async function postponeScheduledEventAction(
  input: z.input<typeof postponeSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard(input)
  if (!g.ok) return { ok: false, error: g.error }
  const parsed = postponeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const res = await postponeScheduledEvent(parsed.data.id, parsed.data.planned_start, {
    userId: g.userId,
    orgId: g.orgId,
    reason: parsed.data.reason,
    newEnd: parsed.data.planned_end ?? null,
  })
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath(`/m/site/${parsed.data.site_id}`)
  return { ok: true }
}

const cancelSchema = idSchema.extend({ reason: z.string().trim().max(500).nullish() })

export async function cancelScheduledEventAction(
  input: z.input<typeof cancelSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard(input)
  if (!g.ok) return { ok: false, error: g.error }
  const parsed = cancelSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const res = await cancelScheduledEvent(parsed.data.id, {
    userId: g.userId, orgId: g.orgId, reason: parsed.data.reason,
  })
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath(`/m/site/${parsed.data.site_id}`)
  return { ok: true }
}

/**
 * Démarrer. Idempotent : deux clics rendent le MÊME compte-rendu — la garde est
 * dans la couche métier (update conditionnel), pas dans l'écran.
 */
export async function startScheduledEventAction(
  input: z.input<typeof idSchema>,
): Promise<{ ok: true; reportId: string | null } | { ok: false; error: string }> {
  const g = await guard(input)
  if (!g.ok) return { ok: false, error: g.error }

  const res = await startScheduledEvent(g.data.id, { userId: g.userId, orgId: g.orgId })
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath(`/m/site/${g.data.site_id}`)
  return { ok: true, reportId: res.value.reportId }
}

const completeSchema = idSchema.extend({ note: z.string().trim().max(1000).nullish() })

export async function completeScheduledEventAction(
  input: z.input<typeof completeSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard(input)
  if (!g.ok) return { ok: false, error: g.error }
  const parsed = completeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  const res = await completeScheduledEvent(parsed.data.id, {
    userId: g.userId, orgId: g.orgId, note: parsed.data.note,
  })
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath(`/m/site/${parsed.data.site_id}`)
  return { ok: true }
}
