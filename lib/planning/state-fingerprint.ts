// DOC-CONTRACT-OS-1B4-C1 — empreinte déterministe de l'état Planning CIBLE
// (grille du cycle ou champs du rythme simple), capturée à la décision et
// recalculée à la lecture pour détecter un décalage (mandat §6/§12).
//
// JAMAIS basée sur `updated_at` : deux lectures du même contenu métier — même
// si la ligne a été ré-écrite avec des valeurs identiques (ex. régénération
// idempotente) — doivent produire la MÊME empreinte. AUCUNE dépendance
// Supabase/DB — reçoit un état déjà résolu par l'appelant.

import { createHash } from 'node:crypto'
import { canonicalStringify } from '@/lib/knowledge/tracked-point-fingerprint'
import type { CycleSlot, SlotState } from '@/lib/db/planning-cycles'

export type CanonicalCycleSlot = {
  weekIndex: number
  weekday: number
  teamId: string
  state: SlotState
  startTime: string | null
  endTime: string | null
}

export type CanonicalCycleState = {
  id: string
  missionId: string
  status: string
  supersedesCycleId: string | null
  cycleLengthWeeks: number
  anchorDate: string
  startsOn: string
  endsOn: string | null
  slots: CanonicalCycleSlot[]
}

function sortSlots(slots: readonly CanonicalCycleSlot[]): CanonicalCycleSlot[] {
  return [...slots].sort((a, b) => {
    if (a.weekIndex !== b.weekIndex) return a.weekIndex - b.weekIndex
    if (a.weekday !== b.weekday) return a.weekday - b.weekday
    return a.teamId.localeCompare(b.teamId)
  })
}

/** Construit l'état canonique depuis des CycleSlot (lib/db/planning-cycles.ts)
 *  — même forme que ce que retourne listCyclesBySite, sans jointure supplémentaire. */
export function buildCanonicalCycleState(cycle: {
  id: string
  missionId: string
  status: string
  supersedesCycleId: string | null
  cycleLengthWeeks: number
  anchorDate: string
  startsOn: string
  endsOn: string | null
  slots: readonly CycleSlot[]
}): CanonicalCycleState {
  return {
    id: cycle.id,
    missionId: cycle.missionId,
    status: cycle.status,
    supersedesCycleId: cycle.supersedesCycleId,
    cycleLengthWeeks: cycle.cycleLengthWeeks,
    anchorDate: cycle.anchorDate,
    startsOn: cycle.startsOn,
    endsOn: cycle.endsOn,
    slots: sortSlots(
      cycle.slots.map((s) => ({
        weekIndex: s.weekIndex,
        weekday: s.weekday,
        teamId: s.teamId,
        state: s.state,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    ),
  }
}

export function computeCycleStateFingerprint(state: CanonicalCycleState): string {
  const canonical: CanonicalCycleState = { ...state, slots: sortSlots(state.slots) }
  return createHash('sha256').update(canonicalStringify(canonical)).digest('hex')
}

export type CanonicalSimpleTemplateState = {
  id: string
  missionId: string
  active: boolean
  deletedAt: string | null
  frequency: string
  slots: string[]
  dayOfWeek: number | null
  dayOfMonth: number | null
  plannedStartHHMM: string | null
  plannedEndHHMM: string | null
  startsOn: string
  endsOn: string | null
}

export function buildCanonicalSimpleTemplateState(template: {
  id: string
  missionId: string
  active: boolean
  deletedAt: string | null
  frequency: string
  slots: readonly string[]
  dayOfWeek: number | null
  dayOfMonth: number | null
  plannedStartHHMM: string | null
  plannedEndHHMM: string | null
  startsOn: string
  endsOn: string | null
}): CanonicalSimpleTemplateState {
  return {
    id: template.id,
    missionId: template.missionId,
    active: template.active,
    deletedAt: template.deletedAt,
    frequency: template.frequency,
    slots: [...template.slots].sort(),
    dayOfWeek: template.dayOfWeek,
    dayOfMonth: template.dayOfMonth,
    plannedStartHHMM: template.plannedStartHHMM,
    plannedEndHHMM: template.plannedEndHHMM,
    startsOn: template.startsOn,
    endsOn: template.endsOn,
  }
}

export function computeSimpleTemplateStateFingerprint(state: CanonicalSimpleTemplateState): string {
  const canonical: CanonicalSimpleTemplateState = { ...state, slots: [...state.slots].sort() }
  return createHash('sha256').update(canonicalStringify(canonical)).digest('hex')
}
