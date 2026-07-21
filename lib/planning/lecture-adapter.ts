import type { SiteRow } from '@/lib/week-planning-helpers'
import type {
  LectureAssignment,
  LectureGap,
  LectureMission,
  LectureRotation,
  LectureScope,
  PlanningLectureInput,
} from '@/lib/planning/lecture'

interface LectureMissionOption {
  id: string
  name: string
  siteName: string
  siteId?: string
  clientName?: string | null
  contractName?: string | null
  defaultTeamId?: string | null
}

interface LectureRotationOption {
  id: string
  missionId: string
  missionName: string
  siteId: string
  title: string
  label: string
  endsOn?: string | null
}

export function buildPlanningLectureInput({
  scope,
  anchorDate,
  focusDate,
  rows,
  missions,
  rotations,
}: {
  scope: LectureScope
  anchorDate: string
  focusDate?: string
  rows: SiteRow[]
  missions: LectureMissionOption[]
  rotations: LectureRotationOption[]
}): PlanningLectureInput {
  const lectureMissions: LectureMission[] = missions.map((mission) => ({
    id: mission.id,
    name: mission.name,
    siteName: mission.siteName,
  }))
  const lectureRotations: LectureRotation[] = rotations.map((rotation) => ({
    id: rotation.id,
    name: rotation.title || rotation.label || rotation.missionName,
    endsOn: rotation.endsOn ?? null,
  }))

  const assignments: LectureAssignment[] = []
  const gaps: LectureGap[] = []
  for (const row of rows) {
    for (const cells of Object.values(row.days)) {
      for (const cell of cells) {
        if (!cell.template_id) continue
        const assigned = Boolean(cell.assigned_team_id)
        assignments.push({
          id: cell.id,
          missionId: cell.mission_id,
          date: cell.scheduled_for,
          rotationId: cell.template_id,
          assigned,
        })
        if (!assigned) {
          gaps.push({
            date: cell.scheduled_for,
            missionId: cell.mission_id,
            rotationId: cell.template_id,
          })
        }
      }
    }
  }

  return {
    scope,
    anchorDate,
    focusDate,
    rotations: lectureRotations,
    missions: lectureMissions,
    assignments,
    gaps,
  }
}
