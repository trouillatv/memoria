import type { SiteRow } from '@/lib/week-planning-helpers'
import type { MonthRow } from '@/lib/db/month-view'
import type {
  LectureAssignment,
  LectureGap,
  LectureMission,
  LectureMissionGap,
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
  monthRows = [],
}: {
  scope: LectureScope
  anchorDate: string
  focusDate?: string
  rows: SiteRow[]
  missions: LectureMissionOption[]
  rotations: LectureRotationOption[]
  /**
   * E2E-3 (Vincent 2026-09-28) — occurrences PROJETÉES (pas encore
   * matérialisées) : `rows` ne voit qu'`interventions`, donc une mission en
   * pur rythme projeté sans équipe n'y apparaît jamais. `assignedTeamId` sur
   * `projectedOccurrences` porte déjà l'équipe effective (rythme simple ET
   * roulement avancé régénèrent un `intervention_templates` par équipe/slot),
   * donc null ici veut dire réellement « aucune équipe » — jamais une
   * approximation.
   *
   * E2E-FIX-2 correction (revue ChatGPT du SHA e69045a4) — ces occurrences
   * alimentent `missionGaps`, jamais `gaps` : un rythme simple projeté sans
   * équipe n'est pas un trou de roulement (voir doctrine sur
   * `LectureMissionGap`).
   */
  monthRows?: MonthRow[]
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

  // E2E-3 — occurrence projetée dans la période, sans équipe effective : ni
  // matérialisée (absente de `rows`), ni couverte par une rotation en gap
  // (aucune cellule n'existe pour elle). Sans ce bloc, `derivePlanningLecture`
  // n'a strictement aucune visibilité sur elle.
  const missionGaps: LectureMissionGap[] = []
  for (const row of monthRows) {
    for (const [date, facts] of Object.entries(row.days)) {
      for (const occurrence of facts.projectedOccurrences ?? []) {
        if (occurrence.assignedTeamId) continue
        missionGaps.push({
          date,
          missionId: occurrence.missionId,
        })
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
    missionGaps,
  }
}
