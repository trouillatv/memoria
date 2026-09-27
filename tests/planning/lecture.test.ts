import { describe, expect, it } from 'vitest'
import { derivePlanningLecture, type PlanningLectureInput } from '@/lib/planning/lecture'

const base: PlanningLectureInput = {
  scope: 'month',
  anchorDate: '2026-07-17',
  rotations: [{ id: 'rotation-e1', name: 'Roulement E1', endsOn: '2026-07-30' }],
  missions: [
    { id: 'mission-1', name: 'Entretien magasin', siteName: 'Magasin' },
    { id: 'mission-2', name: 'Résidence', siteName: 'Résidence' },
    { id: 'mission-3', name: 'Bureaux', siteName: 'Bureaux' },
  ],
  assignments: [
    { id: 'assignment-1', missionId: 'mission-1', date: '2026-07-17', rotationId: 'rotation-e1', assigned: true },
    { id: 'assignment-2', missionId: 'mission-2', date: '2026-07-17', rotationId: 'rotation-e1', assigned: true },
  ],
  gaps: [
    { date: '2026-07-20', missionId: 'mission-1', rotationId: 'rotation-e1' },
    { date: '2026-07-21', missionId: 'mission-2', rotationId: 'rotation-e1' },
    { date: '2026-07-22', missionId: 'mission-3', rotationId: 'rotation-e1' },
    { date: '2026-07-23', missionId: 'mission-1', rotationId: 'rotation-e1' },
    { date: '2026-07-24', missionId: 'mission-2', rotationId: 'rotation-e1' },
  ],
  missionGaps: [],
}

describe('derivePlanningLecture', () => {
  it('returns one traceable primary lecture from graph evidence', () => {
    expect(derivePlanningLecture(base)).toMatchObject({
      contextLabel: 'Planning · 17 juillet 2026',
      headline: 'Le 17 juillet mérite votre attention.',
      primary: {
        kind: 'rotation-gap-impact',
        sourceId: 'rotation-e1',
        sourceLabel: 'Roulement E1',
        gapCount: 5,
        missionCount: 3,
      },
      evidence: { rotations: 1, missions: 3, assignments: 2 },
    })
  })

  it('is deterministic and does not expose a lecture without evidence', () => {
    expect(derivePlanningLecture(base)).toEqual(derivePlanningLecture(base))
    expect(derivePlanningLecture({ ...base, rotations: [], gaps: [] })).toBeNull()
  })

  it('uses week resolution wording while keeping the same causal contract', () => {
    const result = derivePlanningLecture({ ...base, scope: 'week', anchorDate: '2026-07-20' })
    expect(result?.contextLabel).toBe('Planning · 20 juillet 2026')
    expect(result?.headline).toBe('Le lundi 20 mérite votre attention.')
  })

  // E2E-FIX-2 correction (revue ChatGPT du SHA e69045a4) — un rythme simple
  // projeté sans équipe n'est JAMAIS un trou de roulement. Témoin Vincent :
  // « Entretien Carrelage » (rythme simple lun-ven), occurrences 28/29/30
  // projetées, assignedTeamId null → « Mission prévue sans équipe ».
  it('surfaces a mission-unassigned-impact signal for a projected occurrence with no team, never rotation-gap-impact', () => {
    const result = derivePlanningLecture({
      ...base,
      rotations: [],
      gaps: [],
      missions: [{ id: 'mission-carrelage', name: 'Entretien Carrelage', siteName: 'Résidence' }],
      assignments: [],
      missionGaps: [
        { date: '2026-09-28', missionId: 'mission-carrelage' },
        { date: '2026-09-29', missionId: 'mission-carrelage' },
        { date: '2026-09-30', missionId: 'mission-carrelage' },
      ],
    })

    expect(result).toMatchObject({
      headline: 'Entretien Carrelage est prévu sans équipe.',
      primary: {
        kind: 'mission-unassigned-impact',
        sourceId: 'mission-carrelage',
        sourceLabel: 'Entretien Carrelage',
        siteName: 'Résidence',
        occurrenceCount: 3,
        gapDates: ['2026-09-28', '2026-09-29', '2026-09-30'],
      },
      evidence: { rotations: 0, missions: 1 },
    })
  })

  it('prefers a real rotation-gap-impact over a mission-unassigned-impact when both exist', () => {
    const result = derivePlanningLecture({
      ...base,
      missionGaps: [{ date: '2026-09-28', missionId: 'mission-carrelage' }],
    })
    expect(result?.primary.kind).toBe('rotation-gap-impact')
  })
})
