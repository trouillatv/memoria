import { describe, expect, it } from 'vitest'
import {
  buildVisitPreparationSummary,
  classifyVisitPreparationActivity,
  selectPreparationReminders,
  selectPreparationObjective,
  selectNarrativeHighlights,
  buildVisitObjectiveContextLines,
  buildUnconfirmedQuestion,
  getPreparationFreshness,
  estimatePreparationPhase,
  resolveVisitPreparationPhase,
  groupOpenActivityProposals,
  type VisitPreparationFacts,
} from '@/lib/knowledge/visit-preparation'

describe('visit preparation read model', () => {
  it('chooses the preparation phase from site facts', () => {
    const base: VisitPreparationFacts = {
      hasCompletedVisit: false,
      hasActiveTender: false,
      isFinished: false,
    }

    expect(resolveVisitPreparationPhase(base)).toBe('first_visit')
    expect(resolveVisitPreparationPhase({ ...base, hasActiveTender: true })).toBe('previsit_ao')
    expect(resolveVisitPreparationPhase({ ...base, hasCompletedVisit: true })).toBe('follow_up')
    expect(resolveVisitPreparationPhase({ ...base, isFinished: true })).toBe('history')
  })

  it('builds a short deterministic situation summary', () => {
    expect(buildVisitPreparationSummary({
      openActions: 2,
      openReserves: 1,
      nextPassageLabel: 'jeudi à 8 h 30',
      criticalPoint: 'Vérifier les consignations électriques',
    })).toEqual([
      '2 actions restent ouvertes.',
      '1 réserve reste à lever.',
      'Prochain passage : jeudi à 8 h 30.',
      'Point critique : Vérifier les consignations électriques.',
    ])
  })

  it('keeps open activities visible and distinguishes recent from validated ones', () => {
    expect(classifyVisitPreparationActivity({ endedAt: null, startedAt: '2026-07-25T08:00:00Z' })).toBe('in_progress')
    expect(classifyVisitPreparationActivity({
      endedAt: '2026-07-25T08:00:00Z',
      startedAt: '2026-07-25T07:00:00Z',
      now: '2026-07-25T12:00:00Z',
    })).toBe('very_recent')
    expect(classifyVisitPreparationActivity({
      endedAt: '2026-07-23T08:00:00Z',
      startedAt: '2026-07-23T07:00:00Z',
      now: '2026-07-25T12:00:00Z',
    })).toBe('validated')
  })

  it('keeps proposals from open activities separate from confirmed actions', () => {
    const groups = groupOpenActivityProposals([
      { id: 'visit-open', kind: 'visit', title: 'Visite en cours', href: '/visites/1', status: 'in_progress', photoCount: 3, memoCount: 2, proposals: [] },
      { id: 'visit-closed', kind: 'visit', title: 'Visite validée', href: '/visites/2', status: 'validated', photoCount: 1, memoCount: 0, proposals: [] },
    ], [
      { id: 'p1', reportId: 'visit-open', kind: 'action', title: 'Vérifier le coffret' },
      { id: 'p2', reportId: 'visit-open', kind: 'deadline', title: 'Planifier le contrôle électrique' },
      { id: 'p3', reportId: 'visit-closed', kind: 'action', title: 'Ne doit pas remonter ici' },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ id: 'visit-open', status: 'in_progress', photoCount: 3, memoCount: 2 })
    expect(groups[0].proposals.map((item) => item.title)).toEqual(['Vérifier le coffret', 'Planifier le contrôle électrique'])
  })

  it('selects before-leaving reminders in a deterministic order without duplicates', () => {
    const item = (kind: 'blockage' | 'overdue_action' | 'deadline' | 'watchpoint', text: string, sourceId: string) => ({ kind, text, sourceId, sourceHref: null })
    expect(selectPreparationReminders({
      blockages: [],
      overdueActions: [item('overdue_action', 'Appeler Vincent', 'a1')],
      imminentDeadlines: [item('deadline', 'Vérifier le coffret', 'd1')],
      watchpoints: [item('watchpoint', 'Vérifier le coffret', 'd1')],
      openActivities: [],
      proofs: [],
    })).toHaveLength(2)
  })

  it('selects the travel objective by business priority, never by free generation', () => {
    const action = { kind: 'action' as const, text: 'Clôturer le plan', sourceId: 'a1', sourceHref: '/a1' }
    const deadline = { kind: 'deadline' as const, text: 'Vérifier les lignes', sourceId: 'd1', sourceHref: '/d1' }
    expect(selectPreparationObjective({ scheduled: null, action, deadline, reserve: null, watchpoint: null, decision: null })).toEqual(action)
    expect(selectPreparationObjective({ scheduled: null, action: null, deadline, reserve: null, watchpoint: null, decision: null })).toEqual(deadline)
  })

  it('selects short non-duplicated narrative facts instead of concatenating reports', () => {
    expect(selectNarrativeHighlights([
      'La dépose du matériel est engagée. Le planning reste à diffuser.',
      'Le planning reste à diffuser. Une vigilance subsiste sur les panneaux électriques.',
    ], 4)).toEqual([
      'La dépose du matériel est engagée.',
      'Le planning reste à diffuser.',
      'Une vigilance subsiste sur les panneaux électriques.',
    ])
  })

  it('builds the AI context from persisted narratives and post-visit facts', () => {
    const lines = buildVisitObjectiveContextLines({
      narratives: [{ text: 'La dépose est engagée.', status: 'validated', occurredAt: '2026-07-21' }],
      activities: [{ kind: 'visit', title: 'Visite du 25 juillet', status: 'in_progress', photoCount: 4, memoCount: 2 }],
      changedSinceVenue: ['2 nouvelles photos'],
      openActions: ['Communiquer les accès'],
      overdueActions: ['Programmer la visite PAVE'],
      deadlines: ['Vérification électrique — à planifier'],
      decisions: ['Accès par portail et cadenas à code'],
      reserves: ['Panneaux électriques'],
      watchpoints: ['Le planning reste à confirmer'],
      proofs: ['Photo des panneaux électriques'],
    })

    expect(lines.join('\n')).toContain('Résumé persisté')
    expect(lines.join('\n')).toContain('Activité en cours')
    expect(lines.join('\n')).toContain('Vérification électrique — à planifier')
    expect(lines.join('\n')).toContain('Photo des panneaux électriques')
  })

  it('turns historical announcements into natural field questions', () => {
    expect(buildUnconfirmedQuestion('L’accès sera communiqué sous peu.')).toBe('L’accès sécurisé a-t-il été communiqué ?')
    expect(buildUnconfirmedQuestion('Clim Expert interviendra jeudi et vendredi.')).toBe('Clim Expert est-il effectivement intervenu ?')
    expect(buildUnconfirmedQuestion('Le planning sera diffusé vendredi.')).toBe('Le planning annoncé a-t-il été diffusé et est-il à jour ?')
  })

  it('estimates memory freshness and chantier phase deterministically', () => {
    expect(getPreparationFreshness('2026-07-21T10:00:00Z', '2026-07-25T10:00:00Z')).toEqual({ days: 4, label: 'il y a 4 jours', level: 'recent', at: '2026-07-21T10:00:00Z' })
    expect(getPreparationFreshness('2026-06-01T10:00:00Z', '2026-07-25T10:00:00Z').level).toBe('stale')
    // `at` porte la preuve datée : sans elle, les surfaces ne peuvent afficher
    // qu'un délai relatif, non vérifiable par l'utilisateur.
    expect(getPreparationFreshness(null).at).toBeNull()
    expect(estimatePreparationPhase({ actionTitles: ['Dépose des hottes'], deadlineTitles: [], openReserveCount: 0 })).toBe('Dépose')
    expect(estimatePreparationPhase({ actionTitles: [], deadlineTitles: ['Planifier la visite'], openReserveCount: 0 })).toBe('Préparation')
    expect(estimatePreparationPhase({ actionTitles: [], deadlineTitles: [], openReserveCount: 2 })).toBe('Levée des réserves')
  })
})
