import 'server-only'

export type LectureScope = 'month' | 'week'

export interface LectureRotation {
  id: string
  name: string
  endsOn: string | null
}

export interface LectureMission {
  id: string
  name: string
  siteName: string
}

export interface LectureAssignment {
  id: string
  missionId: string
  date: string
  rotationId: string | null
  assigned: boolean
}

export interface LectureGap {
  date: string
  missionId: string
  rotationId: string | null
}

/**
 * E2E-FIX-2 correction (revue ChatGPT du SHA e69045a4, 2026-09-28) — une
 * occurrence projetée sans équipe n'est PAS un trou de roulement : c'est un
 * fait sur la Mission elle-même, qu'elle soit en rythme simple ou en
 * roulement avancé. La confondre avec `LectureGap` la ferait matcher contre
 * `rotations` (qui contient aussi les rythmes simples) et produirait à tort
 * un signal « roulement actif » — exactement la confusion que l'E2E-FIX
 * devait éliminer.
 */
export interface LectureMissionGap {
  date: string
  missionId: string
}

export interface PlanningLectureInput {
  scope: LectureScope
  anchorDate: string
  focusDate?: string
  rotations: LectureRotation[]
  missions: LectureMission[]
  assignments: LectureAssignment[]
  gaps: LectureGap[]
  missionGaps: LectureMissionGap[]
}

interface PlanningLecturePrimaryBase {
  sourceId: string
  sourceLabel: string
  gapDates: string[]
  missionIds: string[]
}

export type PlanningLecturePrimary =
  | (PlanningLecturePrimaryBase & {
      kind: 'rotation-gap-impact'
      endsOn: string | null
      gapCount: number
      missionCount: number
    })
  | (PlanningLecturePrimaryBase & {
      kind: 'mission-unassigned-impact'
      siteName: string
      occurrenceCount: number
    })

export interface PlanningLecture {
  contextLabel: string
  headline: string
  primary: PlanningLecturePrimary
  evidence: {
    rotations: number
    missions: number
    assignments: number
  }
}

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

const WEEKDAYS = [
  'dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi',
]

function parseDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(iso: string, scope: LectureScope): string {
  const date = parseDate(iso)
  if (!date) return iso
  const day = date.getUTCDate()
  const month = MONTHS[date.getUTCMonth()] ?? ''
  if (scope === 'week') return `${WEEKDAYS[date.getUTCDay()] ?? ''} ${day}`
  return `${day} ${month}`
}

function formatContextDate(iso: string): string {
  const date = parseDate(iso)
  if (!date) return iso
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ''} ${date.getUTCFullYear()}`
}

function stableUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'fr'))
}

export function derivePlanningLecture(input: PlanningLectureInput): PlanningLecture | null {
  const rotationById = new Map(input.rotations.map((rotation) => [rotation.id, rotation]))
  const missionById = new Map(input.missions.map((mission) => [mission.id, mission]))

  const rotationCandidates = input.rotations
    .map((rotation) => {
      const gaps = input.gaps.filter((gap) =>
        gap.rotationId === rotation.id &&
        missionById.has(gap.missionId) &&
        (!input.focusDate || gap.date === input.focusDate),
      )
      const missionIds = stableUnique(gaps.map((gap) => gap.missionId))
      const assignments = input.assignments.filter(
        (assignment) => assignment.rotationId === rotation.id && assignment.assigned && missionById.has(assignment.missionId),
      )
      return {
        rotation,
        gaps,
        missionIds,
        assignments,
        gapDates: stableUnique(gaps.map((gap) => gap.date)),
      }
    })
    .filter((candidate) => candidate.gaps.length > 0 && candidate.missionIds.length > 0)
    .sort((a, b) =>
      b.gaps.length - a.gaps.length ||
      b.missionIds.length - a.missionIds.length ||
      a.rotation.id.localeCompare(b.rotation.id),
    )

  const contextDate = formatContextDate(input.anchorDate)

  const rotationCandidate = rotationCandidates[0]
  if (rotationCandidate) {
    const headlineDate = formatDate(input.anchorDate, input.scope)
    return {
      contextLabel: `Planning · ${contextDate}`,
      headline: `Le ${headlineDate} mérite votre attention.`,
      primary: {
        kind: 'rotation-gap-impact',
        sourceId: rotationCandidate.rotation.id,
        sourceLabel: rotationCandidate.rotation.name,
        endsOn: rotationCandidate.rotation.endsOn,
        gapCount: rotationCandidate.gaps.length,
        missionCount: rotationCandidate.missionIds.length,
        gapDates: rotationCandidate.gapDates,
        missionIds: rotationCandidate.missionIds,
      },
      evidence: {
        rotations: rotationById.has(rotationCandidate.rotation.id) ? 1 : 0,
        missions: rotationCandidate.missionIds.length,
        assignments: rotationCandidate.assignments.length,
      },
    }
  }

  // E2E-FIX-2 correction — pas de vrai trou de roulement : une Mission (rythme
  // simple ou roulement) projetée sans équipe effective reste un fait qui
  // mérite attention, mais JAMAIS sous l'identité d'un roulement.
  const missionCandidates = input.missions
    .map((mission) => {
      const gaps = input.missionGaps.filter((gap) =>
        gap.missionId === mission.id &&
        (!input.focusDate || gap.date === input.focusDate),
      )
      return {
        mission,
        gaps,
        gapDates: stableUnique(gaps.map((gap) => gap.date)),
      }
    })
    .filter((candidate) => candidate.gaps.length > 0)
    .sort((a, b) =>
      b.gaps.length - a.gaps.length ||
      a.mission.id.localeCompare(b.mission.id),
    )

  const missionCandidate = missionCandidates[0]
  if (!missionCandidate) return null

  const assignments = input.assignments.filter(
    (assignment) => assignment.missionId === missionCandidate.mission.id && assignment.assigned,
  )

  return {
    contextLabel: `Planning · ${contextDate}`,
    headline: `${missionCandidate.mission.name} est prévu sans équipe.`,
    primary: {
      kind: 'mission-unassigned-impact',
      sourceId: missionCandidate.mission.id,
      sourceLabel: missionCandidate.mission.name,
      siteName: missionCandidate.mission.siteName,
      occurrenceCount: missionCandidate.gaps.length,
      gapDates: missionCandidate.gapDates,
      missionIds: [missionCandidate.mission.id],
    },
    evidence: {
      rotations: 0,
      missions: 1,
      assignments: assignments.length,
    },
  }
}
