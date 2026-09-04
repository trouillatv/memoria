// V1-1/V1-2 — CONTRAT read-model « Actions à piloter » : KPI sur TOUS les CBO (dont dangling),
// liste par SUJET (CBO rattachés), unknown « à qualifier » jamais ouvert, états C2A consommés tels quels.

import { describe, it, expect } from 'vitest'
import { assembleActionsPilotage, type PilotageSubjectContext } from '@/lib/knowledge/actions-pilotage'
import type { CboReducedEntry } from '@/lib/knowledge/canonical-business-object-evolution'
import type { CboComputedCurrentState } from '@/lib/knowledge/cbo-lifecycle-reducer'

const entry = (cboId: string, subjectId: string | null, label: string, state: CboComputedCurrentState): CboReducedEntry => ({
  cboId, canonicalSubjectId: subjectId, label,
  nature: { nature: 'one_shot', stateChar: 'terminal_candidate' },
  reduced: { computedCurrentState: state, historicalTrajectory: [], stateBasis: [], conflicts: state === 'conflict' ? ['x'] : [], documentaryDivergences: [] },
  documentaryHighCount: 0, suppressedByNature: 0, docOpenCount: 0, membersSharedWithCompletionDoc: 0,
})
const ctx = (id: string, title: string, displayState: PilotageSubjectContext['displayState']): [string, PilotageSubjectContext] =>
  [id, { canonicalSubjectId: id, title, displayState, lastMeaningfulChangeAt: '2025-07-10', pvCount: 8 }]

describe('assembleActionsPilotage — KPI + hiérarchie sujet→CBO', () => {
  it('KPI compte TOUS les CBO ; dangling unknown → à qualifier, absent des sujets', () => {
    const subjectCtx = new Map([ctx('s1', 'Sprinkler', 'reopened')])
    const reduced = [
      entry('c1', 's1', 'Modifier réseau', 'open'),
      entry('c2', 's1', 'Visite semestrielle', 'documentary_completed'),
      entry('c3', null, 'CBO dangling', 'unknown'), // sans sujet
    ]
    const p = assembleActionsPilotage(subjectCtx, reduced, 37)
    expect(p.kpi).toMatchObject({ subjectsWithActions: 1, activeCbo: 1, completedCbo: 1, toQualifyCbo: 1, unattachedCbo: 1, totalCbo: 3, historicalFormulations: 37 })
    // le sujet ne contient QUE ses CBO rattachés (pas le dangling)
    expect(p.subjects).toHaveLength(1)
    expect(p.subjects[0].cbos.map((c) => c.cboId)).toEqual(['c1', 'c2'])
  })

  it('unknown rattaché → à qualifier (jamais actif ni terminé)', () => {
    const p = assembleActionsPilotage(new Map([ctx('s1', 'X', 'open')]), [entry('c1', 's1', 'A', 'unknown')], 0)
    expect(p.kpi.activeCbo).toBe(0)
    expect(p.kpi.toQualifyCbo).toBe(1)
    expect(p.subjects[0].unknownCboCount).toBe(1)
  })

  it('conflict → à qualifier, jamais assimilé à ouvert/terminé', () => {
    const p = assembleActionsPilotage(new Map([ctx('s1', 'X', 'open')]), [entry('c1', 's1', 'A', 'conflict')], 0)
    expect(p.kpi.activeCbo).toBe(0)
    expect(p.kpi.completedCbo).toBe(0)
    expect(p.kpi.toQualifyCbo).toBe(1)
  })

  it('états actifs : open/reopened/progressing comptent ; completed/cancelled/conforme = terminés', () => {
    const states: [CboComputedCurrentState, 'active' | 'done'][] = [
      ['open', 'active'], ['documentary_reopened', 'active'], ['native_reopened', 'active'], ['progressing', 'active'],
      ['documentary_completed', 'done'], ['native_completed', 'done'], ['native_cancelled', 'done'], ['conforme_at', 'done'],
    ]
    const reduced = states.map(([s], i) => entry(`c${i}`, 's1', `A${i}`, s))
    const p = assembleActionsPilotage(new Map([ctx('s1', 'X', 'reopened')]), reduced, 0)
    expect(p.kpi.activeCbo).toBe(4)
    expect(p.kpi.completedCbo).toBe(4)
    expect(p.kpi.toQualifyCbo).toBe(0)
  })

  it('displayState SUJET consommé tel quel (jamais recalculé depuis les CBO)', () => {
    // Calfeutrement : CBO completed mais on n'INVENTE pas resolved — on prend le displayState fourni.
    const p = assembleActionsPilotage(new Map([ctx('s1', 'Calfeutrement', 'resolved')]), [entry('c1', 's1', 'Reprendre calfeutrement', 'documentary_completed')], 1)
    expect(p.subjects[0].displayState).toBe('resolved')
    expect(p.subjects[0].cbos[0].computedCurrentState).toBe('documentary_completed')
  })

  it('tri : sujets avec CBO actifs d\'abord', () => {
    const subjectCtx = new Map([ctx('s1', 'Tout terminé', 'resolved'), ctx('s2', 'Actif', 'open')])
    const p = assembleActionsPilotage(subjectCtx, [entry('c1', 's1', 'A', 'documentary_completed'), entry('c2', 's2', 'B', 'open')], 0)
    expect(p.subjects[0].canonicalSubjectId).toBe('s2') // actif d'abord
  })

  it('CBO actif listé avant terminé DANS le sujet', () => {
    const p = assembleActionsPilotage(new Map([ctx('s1', 'X', 'reopened')]), [entry('c1', 's1', 'Terminé', 'documentary_completed'), entry('c2', 's1', 'Actif', 'open')], 0)
    expect(p.subjects[0].cbos[0].active).toBe(true)
  })

  it('N3 — formulations documentaires attachées au sujet + compte de PV distincts', () => {
    const formulations = new Map([['s1', [
      { id: 'f1', title: 'Reprendre X', status: 'open', dueDate: null, reportId: 'pv1' },
      { id: 'f2', title: 'Reprendre X (bis)', status: 'open', dueDate: '2025-07-10', reportId: 'pv2' },
      { id: 'f3', title: 'X encore', status: 'open', dueDate: null, reportId: 'pv1' },
    ]]])
    const p = assembleActionsPilotage(new Map([ctx('s1', 'X', 'open')]), [entry('c1', 's1', 'A', 'open')], 3, formulations)
    expect(p.subjects[0].formulations).toHaveLength(3)
    expect(p.subjects[0].formulationPvCount).toBe(2) // pv1, pv2 distincts
    expect(p.kpi.historicalFormulations).toBe(3)
  })
})
