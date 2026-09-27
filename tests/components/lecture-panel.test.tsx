import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { derivePlanningLecture, type PlanningLectureInput } from '@/lib/planning/lecture'
import { LecturePanel } from '@/app/(dashboard)/(planning)/LecturePanel'

const input: PlanningLectureInput = {
  scope: 'month',
  anchorDate: '2026-07-17',
  rotations: [{ id: 'rotation-e1', name: 'Roulement E1', endsOn: '2026-07-30' }],
  missions: [
    { id: 'mission-1', name: 'Entretien magasin', siteName: 'Magasin' },
    { id: 'mission-2', name: 'Résidence', siteName: 'Résidence' },
  ],
  assignments: [
    { id: 'assignment-1', missionId: 'mission-1', date: '2026-07-17', rotationId: 'rotation-e1', assigned: true },
  ],
  gaps: [
    { date: '2026-07-20', missionId: 'mission-1', rotationId: 'rotation-e1' },
    { date: '2026-07-21', missionId: 'mission-2', rotationId: 'rotation-e1' },
  ],
  missionGaps: [],
}

describe('LecturePanel', () => {
  it('renders the traceable lecture and existing source links', () => {
    const lecture = derivePlanningLecture(input)
    expect(lecture).not.toBeNull()

    render(
      <LecturePanel
        lecture={lecture!}
        links={{
          rotation: '/sites/site-1/roulements/rotation-e1',
          gaps: '/semaine?week=2026-W30',
          missions: ['/missions/mission-1', '/missions/mission-2'],
        }}
        emptyContextLabel="Planning · juillet 2026"
        rotationCount={1}
        interventionCount={2}
        assignmentCount={1}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Lecture' })).toBeInTheDocument()
    expect(screen.getByText('Planning · 17 juillet 2026')).toBeInTheDocument()
    expect(screen.getByText('Parce que…')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Roulement E1' })).toHaveAttribute(
      'href',
      '/sites/site-1/roulements/rotation-e1',
    )
    expect(screen.getByRole('link', { name: '2 jours sans équipe' })).toHaveAttribute(
      'href',
      '/semaine?week=2026-W30',
    )
    expect(screen.getByRole('link', { name: /Voir la fiche du Roulement E1/ })).toHaveAttribute(
      'href',
      '/sites/site-1/roulements/rotation-e1',
    )
    expect(screen.getByText('1 roulement')).toBeInTheDocument()
    expect(screen.getByText('2 missions')).toBeInTheDocument()
    expect(screen.getByText('1 affectation')).toBeInTheDocument()
  })

  // E2E-FIX-2 correction (revue ChatGPT du SHA e69045a4) — un signal
  // `mission-unassigned-impact` ne doit JAMAIS parler de « roulement ».
  it('renders mission-unassigned-impact without any rotation wording', () => {
    const lecture = derivePlanningLecture({
      scope: 'week',
      anchorDate: '2026-09-28',
      rotations: [],
      missions: [{ id: 'mission-carrelage', name: 'Entretien Carrelage', siteName: 'Résidence' }],
      assignments: [],
      gaps: [],
      missionGaps: [
        { date: '2026-09-28', missionId: 'mission-carrelage' },
        { date: '2026-09-29', missionId: 'mission-carrelage' },
        { date: '2026-09-30', missionId: 'mission-carrelage' },
      ],
    })
    expect(lecture).not.toBeNull()

    render(
      <LecturePanel
        lecture={lecture!}
        links={{
          rotation: '/roulements',
          gaps: '/semaine?week=2026-W40',
          missions: ['/missions/mission-carrelage'],
        }}
        emptyContextLabel="Planning · septembre 2026"
        rotationCount={0}
        interventionCount={0}
        assignmentCount={0}
      />,
    )

    expect(screen.getByText('Entretien Carrelage est prévu sans équipe.')).toBeInTheDocument()
    expect(screen.getByText('Mission prévue sans équipe')).toBeInTheDocument()
    expect(screen.getByText('3 passages concernés cette semaine')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entretien Carrelage' })).toHaveAttribute(
      'href',
      '/missions/mission-carrelage',
    )
    expect(screen.getByRole('link', { name: /Voir la fiche de Entretien Carrelage/ })).toHaveAttribute(
      'href',
      '/missions/mission-carrelage',
    )
    expect(screen.queryByText(/roulement/i)).not.toBeInTheDocument()
  })

  it('renders no empty shell when no deterministic lecture exists', () => {
    render(
      <LecturePanel
        lecture={null}
        links={{ rotation: '#', gaps: '#', missions: [] }}
        emptyContextLabel="Planning · juillet 2026"
        rotationCount={1}
        interventionCount={0}
        assignmentCount={0}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Lecture' })).toBeInTheDocument()
    expect(screen.getByText('Aucun point ne nécessite votre attention.')).toBeInTheDocument()
  })
})
