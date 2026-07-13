import 'server-only'

// LE ROULEMENT (mig 199, PL4) — l'objet métier de Guillaume.
//
// INVARIANT : le cycle est la SEULE source de vérité. Les rythmes techniques
// (`intervention_templates` portant `cycle_id`) en sont une PROJECTION. Ils ne
// sont JAMAIS éditables à la main : on les RÉGÉNÈRE depuis la grille.
//
// ⚠️ RÉGÉNÉRER N'EST PAS SUPPRIMER. `interventions.template_id` est en
// ON DELETE CASCADE : supprimer un rythme détruirait les interventions déjà
// générées ET LEURS PREUVES. On ARCHIVE (`deleted_at` + `active = false`).
// Une preuve n'est jamais détruite par un geste de rangement.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { slotFromUtcHour } from '@/lib/time/prestation-slot'
import { previousDayIso } from '@/lib/planning/cycle-effect'

export type CycleStatus = 'draft' | 'published' | 'stopped'
export type SlotState = 'work' | 'rest'

/** Une case de la grille : (semaine, jour, équipe) → travail ou repos. */
export interface CycleSlot {
  weekIndex: number // 0 = semaine A
  weekday: number // 1 = lundi … 7 = dimanche
  teamId: string
  state: SlotState
  startTime: string | null // 'HH:MM'
  endTime: string | null
}

export interface PlanningCycle {
  id: string
  siteId: string
  missionId: string
  name: string
  cycleLengthWeeks: number
  anchorDate: string
  startsOn: string
  endsOn: string | null
  status: CycleStatus
  /** La version que ce roulement remplace (mig 206). Une chaîne, pas un arbre. */
  supersedesCycleId: string | null
  slots: CycleSlot[]
}

const CYCLE_COLS =
  'id, site_id, mission_id, name, cycle_length_weeks, anchor_date, starts_on, ends_on, status, supersedes_cycle_id'

/** Dégradation gracieuse tant que la mig 199 n'est pas appliquée. */
function isMissingTable(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ''
  const msg = error.message ?? ''
  return code === '42P01' || msg.includes('planning_cycle')
}

function rowToCycle(r: Record<string, unknown>, slots: CycleSlot[]): PlanningCycle {
  return {
    id: r.id as string,
    siteId: r.site_id as string,
    missionId: r.mission_id as string,
    name: (r.name as string) ?? '',
    cycleLengthWeeks: Number(r.cycle_length_weeks ?? 1),
    anchorDate: (r.anchor_date as string) ?? '',
    startsOn: (r.starts_on as string) ?? '',
    endsOn: (r.ends_on as string | null) ?? null,
    status: (r.status as CycleStatus) ?? 'draft',
    supersedesCycleId: (r.supersedes_cycle_id as string | null) ?? null,
    slots,
  }
}

function rowToSlot(r: Record<string, unknown>): CycleSlot {
  return {
    weekIndex: Number(r.week_index ?? 0),
    weekday: Number(r.weekday ?? 1),
    teamId: r.team_id as string,
    state: (r.state as SlotState) ?? 'work',
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
  }
}

/** Les roulements ACTIFS d'un chantier. */
export async function listCyclesBySite(siteId: string): Promise<PlanningCycle[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('planning_cycles')
    .select(CYCLE_COLS)
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .order('starts_on', { ascending: false })
  if (error) {
    if (isMissingTable(error)) return []
    throw new Error(error.message)
  }
  const cycles = (data ?? []) as Array<Record<string, unknown>>
  if (cycles.length === 0) return []

  const { data: slotRows } = await db
    .from('planning_cycle_slots')
    .select('cycle_id, week_index, weekday, team_id, state, start_time, end_time')
    .in('cycle_id', cycles.map((c) => c.id as string))

  const byCycle = new Map<string, CycleSlot[]>()
  for (const s of (slotRows ?? []) as Array<Record<string, unknown>>) {
    const key = s.cycle_id as string
    ;(byCycle.get(key) ?? byCycle.set(key, []).get(key)!).push(rowToSlot(s))
  }
  return cycles.map((c) => rowToCycle(c, byCycle.get(c.id as string) ?? []))
}

/** Un roulement, vu depuis l'organisation : « quels roulements tournent, où ? » */
export interface CycleOverview extends PlanningCycle {
  siteName: string
  missionName: string
  /** Combien d'équipes tournent dessus. */
  teamCount: number
  /** Jours travaillés sur le cycle (toutes équipes, toutes semaines). */
  workedSlots: number
  /** Jours du cycle où PERSONNE n'est prévu — le trou qu'il cherche du regard. */
  uncoveredDays: number
  updatedAt: string | null
}

/**
 * TOUS les roulements de l'organisation.
 *
 * Cette vue répond à UNE question : « quels roulements existent, et dans quel
 * état sont-ils ? » Elle ne rejoue pas la semaine, elle ne projette rien : la
 * vue Semaine reste l'outil opérationnel, la grille reste l'outil de
 * configuration. Un troisième planning ne servirait personne.
 */
export async function listCyclesForOrg(): Promise<CycleOverview[]> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('planning_cycles')
    .select(`${CYCLE_COLS}, updated_at, sites!inner(name, organization_id), missions(name)`)
    .is('deleted_at', null)
    .order('starts_on', { ascending: false })

  if (error) {
    if (isMissingTable(error)) return []
    throw new Error(error.message)
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  if (rows.length === 0) return []

  // Isolation : le service role contourne la RLS — le filtre org vit dans le code.
  const orgId = await getOrgId().catch(() => null)
  const scoped = orgId
    ? rows.filter((r) => (r.sites as { organization_id?: string })?.organization_id === orgId)
    : rows

  const { data: slotRows } = await db
    .from('planning_cycle_slots')
    .select('cycle_id, week_index, weekday, team_id, state, start_time, end_time')
    .in('cycle_id', scoped.map((c) => c.id as string))

  const byCycle = new Map<string, CycleSlot[]>()
  for (const r of (slotRows ?? []) as Array<Record<string, unknown>>) {
    const key = r.cycle_id as string
    const list = byCycle.get(key) ?? []
    list.push(rowToSlot(r))
    byCycle.set(key, list)
  }

  return scoped.map((r) => {
    const slots = byCycle.get(r.id as string) ?? []
    const worked = slots.filter((s) => s.state === 'work')

    // La couverture : un jour du cycle où personne n'est prévu. C'est le seul
    // signal qu'on calcule ici — déterministe, gratuit, et c'est celui qu'il
    // cherche du regard sur sa feuille.
    const weeks = Number(r.cycle_length_weeks ?? 1)
    const workedDayKeys = new Set(worked.map((s) => `${s.weekIndex}|${s.weekday}`))
    let uncovered = 0
    for (let w = 0; w < weeks; w += 1) {
      for (let d = 1; d <= 7; d += 1) if (!workedDayKeys.has(`${w}|${d}`)) uncovered += 1
    }

    return {
      ...rowToCycle(r, slots),
      siteName: (r.sites as { name?: string })?.name ?? 'Chantier',
      missionName: (r.missions as { name?: string } | null)?.name ?? 'Prestation',
      teamCount: new Set(slots.map((s) => s.teamId)).size,
      workedSlots: worked.length,
      uncoveredDays: uncovered,
      updatedAt: (r.updated_at as string | null) ?? null,
    }
  })
}

/** UN roulement, avec sa grille — c'est ce que Guillaume rouvre. */
export async function getCycle(cycleId: string): Promise<PlanningCycle | null> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('planning_cycles')
    .select(CYCLE_COLS)
    .eq('id', cycleId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(error.message)
  }
  if (!data) return null

  const { data: slotRows } = await db
    .from('planning_cycle_slots')
    .select('week_index, weekday, team_id, state, start_time, end_time')
    .eq('cycle_id', cycleId)

  return rowToCycle(
    data as Record<string, unknown>,
    ((slotRows ?? []) as Array<Record<string, unknown>>).map(rowToSlot),
  )
}

export interface SaveCycleInput {
  siteId: string
  missionId: string
  organizationId: string | null
  name: string
  cycleLengthWeeks: number
  anchorDate: string
  startsOn: string
  endsOn: string | null
  slots: CycleSlot[]
  userId: string | null
  /** PL5b — « Enregistrer comme brouillon » ou « Publier ». Un brouillon ne
   *  génère AUCUN rythme : rien n'arrive dans la semaine tant qu'il n'est pas
   *  publié. */
  status?: CycleStatus
  /** Mig 206 — la version que ce roulement remplace. */
  supersedesCycleId?: string | null
}

/** Crée le roulement + sa grille, puis DÉRIVE ses rythmes. */
export async function createCycle(input: SaveCycleInput): Promise<string> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('planning_cycles')
    .insert({
      site_id: input.siteId,
      mission_id: input.missionId,
      organization_id: input.organizationId,
      name: input.name,
      cycle_length_weeks: input.cycleLengthWeeks,
      anchor_date: input.anchorDate,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      status: input.status ?? 'published',
      supersedes_cycle_id: input.supersedesCycleId ?? null,
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Création du roulement impossible')

  const cycleId = (data as { id: string }).id
  await replaceSlots(cycleId, input.slots)
  await regenerateTemplates(cycleId, input)
  return cycleId
}

/** Modifie le roulement + sa grille, puis RÉGÉNÈRE ses rythmes. */
export async function updateCycle(cycleId: string, input: SaveCycleInput): Promise<void> {
  const db = createAdminClient()
  const { error } = await db
    .from('planning_cycles')
    .update({
      name: input.name,
      cycle_length_weeks: input.cycleLengthWeeks,
      anchor_date: input.anchorDate,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      mission_id: input.missionId,
      status: input.status ?? 'published',
      updated_by: input.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', cycleId)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)

  await replaceSlots(cycleId, input.slots)
  await regenerateTemplates(cycleId, input)
}

/**
 * REMPLACE un roulement publié par une nouvelle version, à partir d'une date.
 *
 * L'ancienne version n'est PAS réécrite : elle a produit des interventions, des
 * preuves, des décisions — réécrire sa grille mentirait sur le passé. Elle est
 * CLOSE la veille de la date d'effet, et ses rythmes régénérés avec cette borne
 * (archivés puis recréés : les interventions déjà générées restent).
 *
 * La nouvelle version démarre à la date d'effet et pointe l'ancienne
 * (`supersedes_cycle_id`). Guillaume voit toujours « Roulement magasin » ;
 * MemorIA garde l'histoire :
 *
 *     Version 1   01/01 → 31/08
 *     Version 2   01/09 → …
 */
export async function supersedeCycle(
  oldCycleId: string,
  input: SaveCycleInput,
  effectiveFrom: string,
): Promise<string> {
  const db = createAdminClient()
  const old = await getCycle(oldCycleId)
  if (!old) throw new Error('Roulement introuvable')

  const oldEndsOn = previousDayIso(effectiveFrom)

  // 1. Clore l'ancienne version — sa grille reste EXACTEMENT ce qu'elle était.
  const { error } = await db
    .from('planning_cycles')
    .update({
      ends_on: oldEndsOn,
      updated_by: input.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', oldCycleId)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)

  // 2. Rebornner ses rythmes (archive + recrée, jamais DELETE) : ils s'arrêtent
  //    désormais la veille de la date d'effet.
  await regenerateTemplates(oldCycleId, {
    siteId: old.siteId,
    missionId: old.missionId,
    organizationId: input.organizationId,
    name: old.name,
    cycleLengthWeeks: old.cycleLengthWeeks,
    anchorDate: old.anchorDate,
    startsOn: old.startsOn,
    endsOn: oldEndsOn,
    slots: old.slots,
    userId: input.userId,
    status: 'published',
  })

  // 3. La nouvelle version, qui démarre à la date d'effet.
  return createCycle({
    ...input,
    startsOn: effectiveFrom,
    supersedesCycleId: oldCycleId,
  })
}

/**
 * TERMINER un roulement : il s'arrête à une date, mais reste VISIBLE — c'est de
 * l'histoire, pas un déchet. (« Retirer », lui, le sort des écrans.)
 */
export async function endCycle(cycleId: string, lastDayIso: string, userId: string | null): Promise<void> {
  const db = createAdminClient()
  const cycle = await getCycle(cycleId)
  if (!cycle) throw new Error('Roulement introuvable')

  const { error } = await db
    .from('planning_cycles')
    .update({ ends_on: lastDayIso, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', cycleId)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)

  // Les rythmes s'arrêtent à la même borne.
  await regenerateTemplates(cycleId, {
    siteId: cycle.siteId,
    missionId: cycle.missionId,
    organizationId: null,
    name: cycle.name,
    cycleLengthWeeks: cycle.cycleLengthWeeks,
    anchorDate: cycle.anchorDate,
    startsOn: cycle.startsOn,
    endsOn: lastDayIso,
    slots: cycle.slots,
    userId,
    status: cycle.status === 'draft' ? 'draft' : 'published',
  })
}

/** Retirer un roulement : il sort des écrans, ses rythmes s'arrêtent — mais
 *  les interventions déjà générées, et leurs preuves, RESTENT. */
export async function softDeleteCycle(cycleId: string): Promise<void> {
  const db = createAdminClient()
  await archiveTemplatesOfCycle(cycleId)
  const { error } = await db
    .from('planning_cycles')
    .update({ deleted_at: new Date().toISOString(), status: 'stopped' })
    .eq('id', cycleId)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
}

// ── Interne ─────────────────────────────────────────────────────────────────

/** La grille est remplacée en bloc : le cycle est la seule vérité. */
async function replaceSlots(cycleId: string, slots: CycleSlot[]): Promise<void> {
  const db = createAdminClient()
  // Les cases n'ont aucune descendance : les effacer ne détruit AUCUNE preuve.
  await db.from('planning_cycle_slots').delete().eq('cycle_id', cycleId)
  if (slots.length === 0) return

  const { error } = await db.from('planning_cycle_slots').insert(
    slots.map((s) => ({
      cycle_id: cycleId,
      week_index: s.weekIndex,
      weekday: s.weekday,
      team_id: s.teamId,
      state: s.state,
      start_time: s.startTime,
      end_time: s.endTime,
    })),
  )
  if (error) throw new Error(error.message)
}

/**
 * ARCHIVE les rythmes d'un cycle. **Jamais de DELETE** : la FK
 * `interventions.template_id` est en CASCADE — un DELETE emporterait les
 * interventions déjà générées et leurs preuves.
 */
async function archiveTemplatesOfCycle(cycleId: string): Promise<void> {
  const db = createAdminClient()
  const { error } = await db
    .from('intervention_templates')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('cycle_id', cycleId)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
}

/**
 * DÉRIVE les rythmes depuis la grille. Un rythme par case TRAVAILLÉE ; les
 * repos ne génèrent rien (mais restent stockés : Guillaume veut les revoir).
 *
 * Les anciens rythmes sont ARCHIVÉS, jamais supprimés — l'historique déjà
 * généré reste intact et lisible.
 */
async function regenerateTemplates(cycleId: string, input: SaveCycleInput): Promise<void> {
  await archiveTemplatesOfCycle(cycleId)

  // Un BROUILLON ne génère aucun rythme : rien n'arrive dans la semaine tant que
  // Guillaume n'a pas publié. (Et s'il repasse en brouillon, les rythmes déjà
  // dérivés viennent d'être archivés — les interventions générées, elles,
  // restent : une preuve n'est jamais détruite par un geste de rangement.)
  if ((input.status ?? 'published') !== 'published') return

  const work = input.slots.filter((s) => s.state === 'work')
  if (work.length === 0) return

  const rows = work.map((s) => {
    const start = s.startTime ?? null
    return {
      mission_id: input.missionId,
      organization_id: input.organizationId,
      cycle_id: cycleId,
      title: input.name.slice(0, 200),
      // Un jour précis d'une semaine précise du cycle.
      frequency: 'weekly' as const,
      day_of_week: s.weekday,
      cycle_length_weeks: input.cycleLengthWeeks,
      anchor_date: input.anchorDate,
      week_index: s.weekIndex,
      // L'équipe de la CASE prime sur celle de la mission : c'est ce qui rend
      // possible « équipe A le lundi, équipe B le mardi ».
      assigned_team_id: s.teamId,
      planned_start_hhmm: start,
      planned_end_hhmm: s.endTime ?? null,
      // Le créneau reste dérivé de l'heure (grille + index d'unicité).
      slots: start ? [slotFromUtcHour(Number(start.slice(0, 2)))] : null,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      created_by: input.userId,
      active: true,
    }
  })

  const { error } = await createAdminClient().from('intervention_templates').insert(rows)
  if (error) throw new Error(error.message)
}
