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
import { requireSiteWriteAccess } from '@/lib/auth/site-write-access'
import { requireTeamCompatibleWithOrg } from '@/lib/auth/team-compatibility'
import { createAdminClient } from '@/lib/supabase/admin'
import { findOrCreateMissionByName, getMission } from '@/lib/db/missions'
import {
  createCycle,
  updateCycle,
  supersedeCycle,
  savePublishedCycleAtomic,
  supersedeCyclePublishedAtomic,
  softDeleteCycle,
  getCycle,
  type CycleSlot,
  type PlanningCycle,
} from '@/lib/db/planning-cycles'
import { resolveEffectiveDate, isRealSplit } from '@/lib/planning/cycle-effect'
import { todayLocalIso } from '@/lib/time/local-date'
import { listActiveClosuresForSites, type SiteClosure } from '@/lib/db/site-closures'
import { previewCycle, type PreviewResult } from '@/lib/planning/cycle-preview'
import { logAuditEvent } from '@/lib/audit/log'

type Result =
  | { ok: true; cycleId: string }
  | { error: string; conflict?: 'replace_simple_with_cycle' }

// PLAN-INTEG-1 — refus UNIFORME (comme la frontière M2C de recurrences-actions.ts) :
// ni « n'existe pas » ni « pas le droit », un message unique, aucun oracle sur
// l'existence d'un roulement ou d'une prestation étrangère.
const REFUS = 'Accès refusé' as const

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
    confirmReplaceRhythm: z.boolean().optional(),
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

/**
 * Publie un roulement qui vient d'être créé/mis à jour EN BROUILLON — le seul
 * appel restant hors du périmètre PLAN-INTEG-1 FINAL : bootstrap
 * brouillon→publié, sans aucun état publié préexistant à protéger par une
 * transaction unique (`fn_plan_publish_cycle_exclusive` reste elle-même une
 * seule RPC atomique, mig 442).
 */
async function publishCycleViaRpc(
  cycleId: string,
  confirmReplaceRhythm: boolean,
  actorId: string | null,
): Promise<{ error: string; conflict?: 'replace_simple_with_cycle' } | null> {
  const { error } = await (createAdminClient() as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>
  }).rpc('fn_plan_publish_cycle_exclusive', {
    p_cycle_id: cycleId,
    p_confirm_replace_simple: confirmReplaceRhythm,
    p_actor_id: actorId,
  })
  if (!error) return null
  if (error.message.includes('PLAN_INTEG_REPLACE_SIMPLE_REQUIRED')) {
    return {
      error: 'Cette mission utilise déjà un rythme simple. Confirmez le remplacement pour publier ce roulement.',
      conflict: 'replace_simple_with_cycle',
    }
  }
  return { error: error.message }
}

export async function saveCycleAction(input: unknown): Promise<Result> {
  const parsed = cycleSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Saisie invalide' }
  const d = parsed.data

  // PLAN-INTEG-1 : le site RÉEL de la ressource fait foi — jamais le siteId
  // renvoyé par le client. Un roulement existant l'indique lui-même (son
  // propre site_id) ; à la création, la ressource ciblée est le chantier visé.
  let existing: PlanningCycle | null = null
  if (d.cycleId) {
    existing = await getCycle(d.cycleId)
    if (!existing) return { error: REFUS }
  }
  const siteId = existing ? existing.siteId : d.siteId

  // M2C : l'organisation vient du chantier (résolue serveur), PUIS le rôle DANS
  // cette organisation — jamais `users.role` (le profil global) combiné à une
  // simple vérification d'appartenance, qui laissait passer un rôle insuffisant
  // dans l'organisation réelle de la ressource.
  const access = await requireSiteWriteAccess(siteId, 'managerOrAdmin')
  if (!access.ok) return { error: access.error }

  // La prestation : celle qu'il a choisie — doit appartenir à CE chantier — ou
  // celle qu'il vient d'écrire.
  let missionId: string
  if (d.missionId) {
    const mission = await getMission(d.missionId)
    if (!mission || mission.site_id !== siteId) return { error: REFUS }
    missionId = d.missionId
  } else {
    try {
      missionId = await findOrCreateMissionByName({
        siteId,
        name: d.missionName!,
        userId: access.userId,
      })
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Prestation impossible à créer' }
    }
  }

  // PLAN-SEC-1 : chaque équipe citée doit appartenir à l'organisation RÉELLE
  // du chantier (pas seulement être accessible à l'appelant).
  for (const teamId of new Set(d.slots.map((s) => s.teamId))) {
    const compatibleTeam = await requireTeamCompatibleWithOrg(teamId, access.organizationId)
    if (!compatibleTeam.allowed) return { error: compatibleTeam.error }
  }

  const supabase = createAdminClient()

  const slots: CycleSlot[] = d.slots.map((s) => ({
    weekIndex: s.weekIndex,
    weekday: s.weekday,
    teamId: s.teamId,
    state: s.state,
    startTime: s.startTime,
    endTime: s.endTime,
  }))

  if (d.status === 'published' && !d.confirmReplaceRhythm) {
    const { data: conflictingSimple, error: conflictErr } = await supabase
      .from('intervention_templates')
      .select('id')
      .eq('mission_id', missionId)
      .eq('active', true)
      .is('deleted_at', null)
      .is('cycle_id', null)
      .lte('starts_on', d.endsOn ?? '9999-12-31')
      .or(`ends_on.is.null,ends_on.gte.${d.startsOn}`)
      .limit(1)
    if (conflictErr) return { error: conflictErr.message }
    if ((conflictingSimple ?? []).length > 0) {
      return {
        error: 'Cette mission utilise déjà un rythme simple. Confirmez le remplacement pour publier ce roulement.',
        conflict: 'replace_simple_with_cycle',
      }
    }
  }

  const payload = {
    siteId,
    missionId,
    organizationId: access.organizationId,
    name: d.name,
    cycleLengthWeeks: d.cycleLengthWeeks,
    anchorDate: d.anchorDate,
    startsOn: d.startsOn,
    endsOn: d.endsOn,
    slots,
    userId: access.userId,
    status: d.status,
  }

  let cycleId: string
  if (d.cycleId) {
    // `existing` a déjà été chargé plus haut pour résoudre le site réel — il
    // ne peut pas être null ici (sinon on aurait déjà refusé l'accès).
    const current = existing!

    // LA DATE D'EFFET. Un roulement PUBLIÉ a un passé : il a produit des
    // interventions et des preuves. Le modifier « à partir de » ne réécrit
    // donc pas ce passé — il CLÔT l'ancienne version et en ouvre une nouvelle.
    // « rewrite » (ou un brouillon, qui n'a pas d'histoire) corrige sur place.
    const resolved = resolveEffectiveDate(d.effect ?? 'rewrite', d.effectDate ?? null, todayLocalIso())
    if ('error' in resolved) return { error: resolved.error }

    const isSplit = current.status === 'published' && resolved.date != null && isRealSplit(resolved.date, current.startsOn)

    if (current.status === 'published' && d.status === 'published') {
      // PLAN-INTEG-1 FINAL — un roulement déjà PUBLIÉ qui reste/devient publié
      // passe entièrement par une RPC ATOMIQUE (mig 444) : champs, cases,
      // exclusivité SIMPLE/ROULEMENT et régénération dans UNE transaction
      // Postgres. Plus de séquence updateCycle/supersedeCycle → RPC publish en
      // commits séparés, qui laissait l'ancien roulement muté sans rollback en
      // cas d'échec tardif.
      if (isSplit) {
        const result = await supersedeCyclePublishedAtomic({
          oldCycleId: d.cycleId,
          effectiveFrom: resolved.date!,
          payload,
          confirmReplaceSimple: d.confirmReplaceRhythm ?? false,
          actorId: access.userId,
        })
        if ('error' in result) return result
        cycleId = result.cycleId
      } else {
        const result = await savePublishedCycleAtomic({
          cycleId: d.cycleId,
          payload,
          confirmReplaceSimple: d.confirmReplaceRhythm ?? false,
          actorId: access.userId,
        })
        if ('error' in result) return result
        cycleId = d.cycleId
      }
    } else if (isSplit) {
      // Brouillon → nouvelle version publiée : la version est créée en
      // BROUILLON, puis publiée par la RPC exclusive ci-dessous — jamais
      // insérée déjà publiée hors de son verrou.
      cycleId = await supersedeCycle(d.cycleId, d.status === 'published' ? { ...payload, status: 'draft' } : payload, resolved.date!)
      if (d.status === 'published') {
        const err = await publishCycleViaRpc(cycleId, d.confirmReplaceRhythm ?? false, access.userId)
        if (err) return err
      }
    } else {
      // Effet avant le premier jour = il n'y a rien à découper : c'est une
      // réécriture qui ne dit pas son nom, on la traite comme telle. Pas
      // d'état publié préexistant à corrompre ici (sinon le bloc ci-dessus
      // aurait intercepté le cas) : un seul appel déjà atomique suffit.
      await updateCycle(d.cycleId, d.status === 'published' ? { ...payload, status: 'draft' } : payload)
      cycleId = d.cycleId
      if (d.status === 'published') {
        const err = await publishCycleViaRpc(cycleId, d.confirmReplaceRhythm ?? false, access.userId)
        if (err) return err
      }
    }
  } else {
    cycleId = await createCycle(d.status === 'published' ? { ...payload, status: 'draft' } : payload)
    if (d.status === 'published') {
      const err = await publishCycleViaRpc(cycleId, d.confirmReplaceRhythm ?? false, access.userId)
      if (err) return err
    }
  }

  await logAuditEvent({
    userId: access.userId,
    entityType: 'site',
    entityId: siteId,
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

  revalidateAll(siteId, cycleId)
  return { ok: true, cycleId }
}

export async function removeCycleAction(cycleId: string): Promise<{ ok: true } | { error: string }> {
  if (!z.string().uuid().safeParse(cycleId).success) return { error: 'Identifiant invalide' }

  const existing = await getCycle(cycleId)
  if (!existing) return { error: REFUS }
  const access = await requireSiteWriteAccess(existing.siteId, 'managerOrAdmin')
  if (!access.ok) return { error: access.error }

  // Les rythmes sont ARCHIVÉS ; les interventions déjà générées RESTENT.
  await softDeleteCycle(cycleId)

  await logAuditEvent({
    userId: access.userId,
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
