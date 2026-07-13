// PL5b — « À quoi va ressembler mon mois ? » AVANT de publier.
//
// RÈGLE ABSOLUE : l'aperçu ne matérialise RIEN. Aucune intervention n'est créée,
// aucun rythme n'est écrit. On fabrique les rythmes EN MÉMOIRE depuis la grille,
// et on les passe au moteur de projection (PL1) — le même que la génération, la
// semaine et les alertes. Une seule vérité.
//
//     grille du roulement (draft, même pas enregistré)
//              ↓  templates VIRTUELS
//     projectOccurrences (PL1)
//              ↓  × findClosureForDate (PL2)
//     ce que Guillaume verra — et ce qu'il doit corriger AVANT de publier.

import { projectOccurrences, type ProjectableTemplate } from './projection'
import { findClosureForDate, type ProjectableClosure } from './closures'

export interface DraftSlot {
  weekIndex: number
  weekday: number
  teamId: string
  state: 'work' | 'rest'
  startTime: string | null
  endTime: string | null
}

export interface DraftCycle {
  missionId: string
  cycleLengthWeeks: number
  anchorDate: string
  startsOn: string
  endsOn: string | null
  slots: DraftSlot[]
}

/** Un jour du mois, tel qu'il sera vécu. */
export interface PreviewDay {
  /** yyyy-mm-dd */
  date: string
  /** Qui travaille — et à quelle heure. */
  working: Array<{ teamId: string; startTime: string | null; endTime: string | null }>
  /** Qui est au repos ce jour-là (le repos se VOIT : sa feuille est faite pour ça). */
  restingTeamIds: string[]
  /** Combien de personnes présentes. 0 = le trou qu'il cherche du regard. */
  coverage: number
  /** La fermeture applicable, s'il y en a une. */
  closure: ProjectableClosure | null
  /** Fermé ET du monde prévu → une décision l'attend. */
  conflict: boolean
}

export interface PreviewResult {
  days: PreviewDay[]
  /** Ce qu'il doit regarder avant de publier. */
  summary: {
    workedDays: number
    /** Jours SANS personne — le trou. */
    uncoveredDays: number
    conflicts: number
    /** Jours travaillés par équipe (sa feuille totalise : 9, 23, 22). */
    daysByTeam: Record<string, number>
  }
}

/**
 * Fabrique les rythmes VIRTUELS d'une grille. Rien n'est écrit : ces objets ne
 * vivent que le temps du calcul.
 *
 * Un rythme par case TRAVAILLÉE. Les repos ne génèrent rien — mais ils restent
 * dans la grille, et l'aperçu les affiche.
 *
 * L'`id` synthétique encode la case : il n'a pas besoin d'exister en base, le
 * moteur ne s'en sert que pour distinguer les occurrences.
 */
export function draftTemplates(cycle: DraftCycle): ProjectableTemplate[] {
  return cycle.slots
    .filter((s) => s.state === 'work')
    .map((s) => ({
      id: `draft|${s.weekIndex}|${s.weekday}|${s.teamId}`,
      mission_id: cycle.missionId,
      frequency: 'weekly' as const,
      slots: null,
      day_of_week: s.weekday,
      day_of_month: null,
      planned_start_hhmm: s.startTime,
      planned_end_hhmm: s.endTime,
      starts_on: cycle.startsOn,
      ends_on: cycle.endsOn,
      cycle_length_weeks: cycle.cycleLengthWeeks,
      anchor_date: cycle.anchorDate,
      week_index: s.weekIndex,
    }))
}

/** L'équipe d'une case, retrouvée depuis l'id synthétique. */
function teamOf(templateId: string): string {
  return templateId.split('|')[3] ?? ''
}

const DAY_MS = 86_400_000

/**
 * Projette le roulement sur [from, to] et croise avec les fermetures.
 * Pur, déterministe, sans effet de bord — et **sans aucune écriture**.
 */
export function previewCycle(params: {
  cycle: DraftCycle
  closures: ProjectableClosure[]
  /** yyyy-mm-dd */
  from: string
  to: string
}): PreviewResult {
  const { cycle, closures, from, to } = params
  const templates = draftTemplates(cycle)
  const occurrences = projectOccurrences({ templates, from, to })

  // Qui travaille, jour par jour.
  const workingByDate = new Map<string, PreviewDay['working']>()
  for (const o of occurrences) {
    const list = workingByDate.get(o.scheduledFor) ?? []
    const slot = cycle.slots.find(
      (s) => s.state === 'work' && `draft|${s.weekIndex}|${s.weekday}|${s.teamId}` === o.templateId,
    )
    list.push({
      teamId: teamOf(o.templateId),
      startTime: slot?.startTime ?? null,
      endTime: slot?.endTime ?? null,
    })
    workingByDate.set(o.scheduledFor, list)
  }

  const allTeams = [...new Set(cycle.slots.map((s) => s.teamId))]
  const days: PreviewDay[] = []
  const daysByTeam: Record<string, number> = Object.fromEntries(allTeams.map((t) => [t, 0]))
  let uncoveredDays = 0
  let conflicts = 0
  let workedDays = 0

  const start = new Date(`${from}T00:00:00.000Z`).getTime()
  const end = new Date(`${to}T00:00:00.000Z`).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    return { days: [], summary: { workedDays: 0, uncoveredDays: 0, conflicts: 0, daysByTeam } }
  }

  for (let t = start; t <= end; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10)
    // Hors période du roulement : le jour n'existe pas dans l'aperçu.
    if (date < cycle.startsOn || (cycle.endsOn && date > cycle.endsOn)) continue

    const working = workingByDate.get(date) ?? []
    const workingIds = new Set(working.map((w) => w.teamId))
    const closure = findClosureForDate(closures, date)
    const conflict = Boolean(closure) && working.length > 0

    for (const w of working) daysByTeam[w.teamId] = (daysByTeam[w.teamId] ?? 0) + 1
    if (working.length === 0) uncoveredDays += 1
    else workedDays += 1
    if (conflict) conflicts += 1

    days.push({
      date,
      working,
      restingTeamIds: allTeams.filter((id) => !workingIds.has(id)),
      coverage: working.length,
      closure,
      conflict,
    })
  }

  return { days, summary: { workedDays, uncoveredDays, conflicts, daysByTeam } }
}
