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
import { createAdminClient } from '@/lib/supabase/admin'
import { findOrCreateMissionByName } from '@/lib/db/missions'
import {
  createCycle,
  updateCycle,
  supersedeCycle,
  softDeleteCycle,
  getCycle,
  type CycleSlot,
} from '@/lib/db/planning-cycles'
import { resolveEffectiveDate, isRealSplit } from '@/lib/planning/cycle-effect'
import { todayLocalIso } from '@/lib/time/local-date'
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
    /** La prestation choisie dans la liste. Absent si Guillaume en a tapé une
     *  nouvelle — voir `missionName`. */
    missionId: z.string().uuid().optional(),
    /** La prestation ÉCRITE au clavier. Si elle existe déjà sur ce chantier, on
     *  la réutilise ; sinon on l'ouvre — et elle sera proposée la prochaine fois,
     *  ici comme ailleurs dans l'organisation. */
    missionName: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().min(1, 'Donnez un nom au roulement').max(200),
    cycleLengthWeeks: z.number().int().min(1).max(4),
    anchorDate: dateIso,
    startsOn: dateIso,
    endsOn: dateIso.nullable(),
    slots: z.array(slotSchema).max(4 * 7 * 20),
    /** PL5b — « Enregistrer comme brouillon » ou « Publier ». */
    status: z.enum(['draft', 'published']).default('published'),
    /** LA DATE D'EFFET (mig 206). Quatre intentions, jamais devinées :
     *  rewrite = « je me suis trompé » (corrige la règle sur place) ;
     *  immediate / next_monday / date = le passé reste vrai, une nouvelle
     *  VERSION démarre à la date d'effet. */
    effect: z.enum(['rewrite', 'immediate', 'next_monday', 'date']).optional(),
    effectDate: dateIso.nullable().optional(),
  })
  .superRefine((d, ctx) => {
    // Il faut une prestation : choisie, ou écrite. Sans elle, le roulement ne
    // sait pas ce qu'il fait faire.
    if (!d.missionId && !d.missionName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Dites quelle prestation',
        path: ['missionName'],
      })
    }
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

  // Organisation du chantier — lue en base pour ne jamais l'accepter du client.
  const supabase = createAdminClient()
  const { data: siteRow } = await supabase.from('sites').select('organization_id').eq('id', d.siteId).maybeSingle()
  if (!siteRow) return { error: 'Chantier introuvable' }

  // La prestation : celle qu'il a choisie, ou celle qu'il vient d'écrire.
  // On la crée sur CE chantier, APRÈS avoir vérifié qu'il lui appartient.
  let missionId: string
  if (d.missionId) {
    const ownedMission = await requireOwned(auth.role, 'missions', d.missionId)
    if (!ownedMission.allowed) return { error: ownedMission.error }
    missionId = d.missionId
  } else {
    try {
      missionId = await findOrCreateMissionByName({
        siteId: d.siteId,
        name: d.missionName!,
        userId: auth.userId,
      })
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Prestation impossible à créer' }
    }
  }

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
    missionId,
    organizationId: siteRow.organization_id,
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

    // LA DATE D'EFFET. Un roulement PUBLIÉ a un passé : il a produit des
    // interventions et des preuves. Le modifier « à partir de » ne réécrit
    // donc pas ce passé — il CLÔT l'ancienne version et en ouvre une nouvelle.
    // « rewrite » (ou un brouillon, qui n'a pas d'histoire) corrige sur place.
    const resolved = resolveEffectiveDate(d.effect ?? 'rewrite', d.effectDate ?? null, todayLocalIso())
    if ('error' in resolved) return { error: resolved.error }

    if (existing.status === 'published' && resolved.date && isRealSplit(resolved.date, existing.startsOn)) {
      cycleId = await supersedeCycle(d.cycleId, payload, resolved.date)
    } else {
      // Effet avant le premier jour = il n'y a rien à découper : c'est une
      // réécriture qui ne dit pas son nom, on la traite comme telle.
      await updateCycle(d.cycleId, payload)
      cycleId = d.cycleId
    }
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
      superseded: d.cycleId && cycleId !== d.cycleId ? d.cycleId : null,
      effect: d.effect ?? null,
      weeks: d.cycleLengthWeeks,
      mission_id: missionId,
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
  // L'aperçu ne matérialise rien : la prestation peut n'exister QUE dans sa tête.
  // On projette la grille sans avoir besoin d'une mission en base.
  missionId: z.string().uuid().nullable().optional(),
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
      missionId: d.missionId ?? 'draft',
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
