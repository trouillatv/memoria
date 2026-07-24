import { describe, expect, it } from 'vitest'
import {
  buildVisitPreparationSummary,
  classifyVisitPreparationActivity,
  selectPreparationReminders,
  selectPreparationObjective,
  selectNarrativeHighlights,
  buildVisitObjectiveContextLines,
  resolveVisitPreparationPhase,
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
})
