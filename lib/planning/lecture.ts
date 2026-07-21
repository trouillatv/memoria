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

export interface PlanningLectureInput {
  scope: LectureScope
  anchorDate: string
  focusDate?: string
  rotations: LectureRotation[]
  missions: LectureMission[]
  assignments: LectureAssignment[]
  gaps: LectureGap[]
}

export interface PlanningLecture {
  contextLabel: string
  headline: string
  primary: {
    kind: 'rotation-gap-impact'
    sourceId: string
    sourceLabel: string
    endsOn: string | null
    gapCount: number
    missionCount: number
    gapDates: string[]
    missionIds: string[]
  }
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

  const candidates = input.rotations
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

  const candidate = candidates[0]
  if (!candidate) return null

  const contextDate = formatContextDate(input.anchorDate)
  const headlineDate = formatDate(input.anchorDate, input.scope)
  return {
    contextLabel: `Planning · ${contextDate}`,
    headline: `Le ${headlineDate} mérite votre attention.`,
    primary: {
      kind: 'rotation-gap-impact',
      sourceId: candidate.rotation.id,
      sourceLabel: candidate.rotation.name,
      endsOn: candidate.rotation.endsOn,
      gapCount: candidate.gaps.length,
      missionCount: candidate.missionIds.length,
      gapDates: candidate.gapDates,
      missionIds: candidate.missionIds,
    },
    evidence: {
      rotations: rotationById.has(candidate.rotation.id) ? 1 : 0,
      missions: candidate.missionIds.length,
      assignments: candidate.assignments.length,
    },
  }
}
