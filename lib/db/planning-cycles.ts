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
import { slotFromUtcHour } from '@/lib/time/prestation-slot'

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
  slots: CycleSlot[]
}

const CYCLE_COLS =
  'id, site_id, mission_id, name, cycle_length_weeks, anchor_date, starts_on, ends_on, status'

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
      status: 'published',
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
      updated_by: input.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', cycleId)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)

  await replaceSlots(cycleId, input.slots)
  await regenerateTemplates(cycleId, input)
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
