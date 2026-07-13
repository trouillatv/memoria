'use server'

// PL5a — créer, rouvrir, modifier, retirer un ROULEMENT.
//
// Le cycle est la SEULE source de vérité : ces actions écrivent la grille, et la
// couche DB régénère les rythmes techniques (en ARCHIVANT les anciens — jamais
// en les supprimant : la FK interventions.template_id est en CASCADE et
// détruirait les preuves).
//
// Sécurité : rôle (manager/admin) PUIS appartenance du CHANTIER et de la
// MISSION. L'équipe de chaque case est vérifiée elle aussi — on ne confie pas
// une prestation à l'équipe d'un autre tenant.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireManagerOrAdmin } from '@/lib/auth/require'
import { requireOwned } from '@/lib/auth/ownership'
import { getOrgId } from '@/lib/db/users'
import {
  createCycle,
  updateCycle,
  softDeleteCycle,
  getCycle,
  type CycleSlot,
} from '@/lib/db/planning-cycles'
import { listActiveClosuresForSites, type SiteClosure } from '@/lib/db/site-closures'
import { previewCycle, type PreviewResult } from '@/lib/planning/cycle-preview'
import { logAuditEvent } from '@/lib/audit/log'

type Result = { ok: true; cycleId: string } | { error: string }

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide')
const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide')

const slotSchema = z.object({
  weekIndex: z.number().int().min(0).max(3),
  weekday: z.number().int().min(1).max(7),
  teamId: z.string().uuid(),
  state: z.enum(['work', 'rest']),
  startTime: hhmm.nullable(),
  endTime: hhmm.nullable(),
})

const cycleSchema = z
  .object({
    cycleId: z.string().uuid().optional(),
    siteId: z.string().uuid(),
    missionId: z.string().uuid(),
    name: z.string().trim().min(1, 'Donnez un nom au roulement').max(200),
    cycleLengthWeeks: z.number().int().min(1).max(4),
    anchorDate: dateIso,
    startsOn: dateIso,
    endsOn: dateIso.nullable(),
    slots: z.array(slotSchema).max(4 * 7 * 20),
    /** PL5b — « Enregistrer comme brouillon » ou « Publier ». */
    status: z.enum(['draft', 'published']).default('published'),
  })
  .superRefine((d, ctx) => {
    if (d.endsOn && d.endsOn < d.startsOn) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fin ne peut pas précéder le début', path: ['endsOn'] })
    }
    for (const s of d.slots) {
      if (s.weekIndex >= d.cycleLengthWeeks) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Une case sort du cycle', path: ['slots'] })
        break
      }
      // Une case travaillée sans horaire ne saurait pas quand commencer.
      if (s.state === 'work' && (!s.startTime || !s.endTime)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Un jour travaillé a besoin d’un horaire', path: ['slots'] })
        break
      }
      if (s.state === 'work' && s.startTime && s.endTime && s.endTime <= s.startTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fin doit être après le début', path: ['slots'] })
        break
      }
    }
  })

export async function saveCycleAction(input: unknown): Promise<Result> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }

  const parsed = cycleSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }
  const d = parsed.data

  // Garde d'appartenance : le chantier, la mission, et chaque équipe citée.
  const ownedSite = await requireOwned(auth.role, 'sites', d.siteId)
  if (!ownedSite.allowed) return { error: ownedSite.error }
  const ownedMission = await requireOwned(auth.role, 'missions', d.missionId)
  if (!ownedMission.allowed) return { error: ownedMission.error }
  for (const teamId of new Set(d.slots.map((s) => s.teamId))) {
    const ownedTeam = await requireOwned(auth.role, 'teams', teamId)
    if (!ownedTeam.allowed) return { error: 'Équipe inconnue' }
  }

  const slots: CycleSlot[] = d.slots.map((s) => ({
    weekIndex: s.weekIndex,
    weekday: s.weekday,
    teamId: s.teamId,
    state: s.state,
    startTime: s.startTime,
    endTime: s.endTime,
  }))

  const payload = {
    siteId: d.siteId,
    missionId: d.missionId,
    organizationId: await getOrgId(),
    name: d.name,
    cycleLengthWeeks: d.cycleLengthWeeks,
    anchorDate: d.anchorDate,
    startsOn: d.startsOn,
    endsOn: d.endsOn,
    slots,
    userId: auth.userId,
    status: d.status,
  }

  let cycleId: string
  if (d.cycleId) {
    // On ne modifie pas le roulement d'un autre tenant : on remonte à son site.
    const existing = await getCycle(d.cycleId)
    if (!existing) return { error: 'Objet introuvable' }
    const ownedCycleSite = await requireOwned(auth.role, 'sites', existing.siteId)
    if (!ownedCycleSite.allowed) return { error: ownedCycleSite.error }
    await updateCycle(d.cycleId, payload)
    cycleId = d.cycleId
  } else {
    cycleId = await createCycle(payload)
  }

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'site',
    entityId: d.siteId,
    action: d.cycleId ? 'updated' : 'created',
    metadata: {
      kind: 'planning_cycle',
      cycle_id: cycleId,
      weeks: d.cycleLengthWeeks,
      worked_slots: slots.filter((s) => s.state === 'work').length,
    },
  })

  revalidateAll(d.siteId, cycleId)
  return { ok: true, cycleId }
}

export async function removeCycleAction(cycleId: string): Promise<{ ok: true } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }
  if (!z.string().uuid().safeParse(cycleId).success) return { error: 'Identifiant invalide' }

  const existing = await getCycle(cycleId)
  if (!existing) return { error: 'Objet introuvable' }
  const owned = await requireOwned(auth.role, 'sites', existing.siteId)
  if (!owned.allowed) return { error: owned.error }

  // Les rythmes sont ARCHIVÉS ; les interventions déjà générées RESTENT.
  await softDeleteCycle(cycleId)

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'site',
    entityId: existing.siteId,
    action: 'removed',
    metadata: { kind: 'planning_cycle', cycle_id: cycleId, mode: 'soft' },
  })

  revalidateAll(existing.siteId, cycleId)
  return { ok: true }
}

function revalidateAll(siteId: string, cycleId: string): void {
  revalidatePath(`/sites/${siteId}/roulements`)
  revalidatePath(`/sites/${siteId}/roulements/${cycleId}`)
  revalidatePath(`/sites/${siteId}`)
  revalidatePath('/semaine')
  revalidatePath('/missions')
}


// ── PL5b — l'APERÇU. Il ne matérialise RIEN. ────────────────────────────────
//
// Aucune intervention n'est créée, aucun rythme n'est écrit. On projette la
// grille (même en brouillon, même pas enregistrée) avec le moteur PL1, et on la
// croise avec les fermetures (PL2). Guillaume corrige AVANT de publier.

const previewSchema = z.object({
  siteId: z.string().uuid(),
  missionId: z.string().uuid(),
  cycleLengthWeeks: z.number().int().min(1).max(4),
  anchorDate: dateIso,
  startsOn: dateIso,
  endsOn: dateIso.nullable(),
  slots: z.array(slotSchema).max(4 * 7 * 20),
  /** Le mois regardé : yyyy-mm-01. */
  from: dateIso,
  to: dateIso,
})

export async function previewCycleAction(
  input: unknown,
): Promise<{ ok: true; preview: PreviewResult } | { error: string }> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { error: auth.error }

  const parsed = previewSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }
  const d = parsed.data

  const owned = await requireOwned(auth.role, 'sites', d.siteId)
  if (!owned.allowed) return { error: owned.error }

  // Les fermetures RÉELLES du chantier sur la période — pour que le conflit
  // affiché soit le vrai.
  const closuresBySite = await listActiveClosuresForSites([d.siteId], d.from, d.to).catch(
    (): Record<string, SiteClosure[]> => ({}),
  )

  const preview = previewCycle({
    cycle: {
      missionId: d.missionId,
      cycleLengthWeeks: d.cycleLengthWeeks,
      anchorDate: d.anchorDate,
      startsOn: d.startsOn,
      endsOn: d.endsOn,
      slots: d.slots,
    },
    closures: closuresBySite[d.siteId] ?? [],
    from: d.from,
    to: d.to,
  })

  return { ok: true, preview }
}
