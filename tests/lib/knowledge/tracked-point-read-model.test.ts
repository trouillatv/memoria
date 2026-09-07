import { describe, expect, it } from 'vitest'
import {
  projectTrackedPoint,
  deriveSubjectPointReadModel,
  projectPendingIdentityCandidates,
  type TrackedPointRow,
  type PendingIdentityCandidateRow,
} from '@/lib/knowledge/tracked-point-read-model'
import type { PointLifecycleEvent, PointCboMember } from '@/lib/knowledge/tracked-point-lifecycle-reducer'
import type { CboComputedCurrentState } from '@/lib/knowledge/cbo-lifecycle-reducer'

const ev = (
  kind: PointLifecycleEvent['kind'],
  attestedAt: string,
  eventAt?: string,
): PointLifecycleEvent => ({ kind, attestedAt, eventAt })

const cbo = (state: CboComputedCurrentState, id = 'cbo1'): PointCboMember => ({
  cboId: id,
  reduced: {
    computedCurrentState: state,
    historicalTrajectory: [],
    stateBasis: [],
    conflicts: state === 'conflict' ? ['x'] : [],
    documentaryDivergences: [],
  },
})

const basePoint = (overrides: Partial<TrackedPointRow> = {}): TrackedPointRow => ({
  id: 'point-1',
  siteId: 'site-1',
  canonicalSubjectId: 'subject-1',
  label: 'Point de test',
  status: 'active',
  mergedIntoId: null,
  identityStatus: 'CONFIRMED',
  foundingKind: 'cbo',
  foundingSource: null,
  foundingReference: null,
  hasUpstreamDefect: false,
  ...overrides,
})

describe('tracked-point-read-model — projectTrackedPoint', () => {
  it('F8 — la preuve documentaire seule ne referme pas un Point fondé sur CBO tant que le CBO reste ouvert', () => {
    const point = basePoint({ id: 'f8', label: 'F8 — porte coupe-feu' })
    const docs = [ev('resolution_signal', '2026-01-10')]
    const openEntry = projectTrackedPoint(point, [cbo('open')], [], [], docs)

    expect(openEntry.derivedState).toBe('open')
    expect(openEntry.hasDocumentaryDivergence).toBe(true)
    expect(openEntry.documentaryDivergences.length).toBeGreaterThan(0)

    // Simule la matérialisation d'une adhésion HARD (future 6C) : le CBO passe à un état résolu.
    const closedEntry = projectTrackedPoint(
      point,
      [cbo('native_completed')],
      ['thread-real-1'],
      [],
      docs,
    )
    expect(closedEntry.derivedState).toBe('resolved')
    expect(closedEntry.hardMemberThreadIds).toEqual(['thread-real-1'])
  })

  it('CTA — deux Points indépendants sous un même sujet ne fusionnent jamais leur état', () => {
    const raccordement = projectTrackedPoint(
      basePoint({ id: 'cta-raccordement', label: 'CTA — raccordement' }),
      [],
      [],
      [],
      [ev('resolution_signal', '2026-01-05')],
    )
    const programmation = projectTrackedPoint(
      basePoint({ id: 'cta-programmation', label: 'CTA — programmation' }),
      [],
      [],
      [],
      [ev('resolution_claimed', '2026-01-06')],
    )

    expect(raccordement.derivedState).toBe('resolved')
    expect(programmation.derivedState).toBe('open')
    expect(programmation.toConfirm).toBe(true)

    const subjectModel = deriveSubjectPointReadModel('subject-cta', [raccordement, programmation])
    expect(subjectModel.totalPoints).toBe(2)
    expect(subjectModel.resolved).toBe(1)
    expect(subjectModel.open).toBe(1)
  })

  it('RIA — trois Points sous un même sujet, dont un consommant le verdict CBO tel quel (ligne 12)', () => {
    const reserves = projectTrackedPoint(
      basePoint({ id: 'ria-reserves', label: 'RIA — réserves' }),
      [],
      [],
      [],
      [ev('resolution_signal', '2026-01-05')],
    )
    const bureauxR1 = projectTrackedPoint(
      basePoint({ id: 'ria-bureaux-r1', label: 'RIA — bureaux R+1' }),
      [],
      [],
      [ev('decision_pending', '2026-01-06')],
      [],
    )
    const listingPlan = projectTrackedPoint(
      basePoint({ id: 'ria-listing-plan', label: 'RIA — listing et plan' }),
      [cbo('open')],
      [],
      [],
      [],
    )

    expect(reserves.derivedState).toBe('resolved')
    expect(bureauxR1.derivedState).toBe('open')
    expect(bureauxR1.awaitingDecision).toBe(true)
    expect(listingPlan.derivedState).toBe('open')

    const subjectModel = deriveSubjectPointReadModel('subject-ria', [reserves, bureauxR1, listingPlan])
    expect(subjectModel.totalPoints).toBe(3)
    expect(subjectModel.resolved).toBe(1)
    expect(subjectModel.open).toBe(2)
  })

  it('Extincteurs — dotation physique et plan documentaire divergent explicitement', () => {
    const entry = projectTrackedPoint(
      basePoint({ id: 'extincteurs-dotation', label: 'Extincteurs — dotation physique' }),
      [cbo('open')],
      [],
      [],
      [ev('resolution_signal', '2026-01-08')],
    )

    expect(entry.derivedState).toBe('open')
    expect(entry.hasDocumentaryDivergence).toBe(true)
  })

  it('Divergence — les champs de convenance exposés au read-model reflètent la divergence CBO/documentaire', () => {
    const entry = projectTrackedPoint(
      basePoint({ id: 'divergence-generique' }),
      [cbo('open')],
      [],
      [],
      [ev('resolution_signal', '2026-01-08')],
    )

    expect(entry.hasDocumentaryDivergence).toBe(true)
    expect(entry.documentaryDivergences.length).toBeGreaterThan(0)
    expect(entry.hasConflict).toBe(false)
  })

  it('Conflict — deux CBO membres en désaccord sans signal natif produisent un conflit exposé', () => {
    const entry = projectTrackedPoint(
      basePoint({ id: 'conflit-multi-cbo' }),
      [cbo('documentary_completed', 'a'), cbo('open', 'b')],
      [],
      [],
      [],
    )

    expect(entry.derivedState).toBe('conflict')
    expect(entry.hasConflict).toBe(true)
    expect(entry.conflicts.length).toBeGreaterThan(0)
  })

  it('Candidate isolation — un candidat pending, même très confiant, ne modifie jamais la projection du Point', () => {
    const point = basePoint({ id: 'isolation-1' })
    const cboMembers = [cbo('native_completed')]
    const hardMemberThreadIds = ['thread-real-1']
    const docs = [ev('resolution_signal', '2026-01-05')]

    const before = projectTrackedPoint(point, cboMembers, hardMemberThreadIds, [], docs)

    const candidateRows: PendingIdentityCandidateRow[] = [
      {
        id: 'candidate-1',
        siteId: 'site-1',
        candidateTraceThreadId: 'thread-candidate-999',
        candidatePointId: point.id,
        reason: 'forte similarité textuelle',
        rail: 'strong_containment',
        status: 'pending',
      },
    ]
    const candidates = projectPendingIdentityCandidates(candidateRows)
    expect(candidates[0].source).toBe('membership_engine')

    const after = projectTrackedPoint(point, cboMembers, hardMemberThreadIds, [], docs)

    expect(after).toEqual(before)
    expect(after.hardMemberThreadIds).not.toContain('thread-candidate-999')
  })

  it('RESOLUTION_WITHOUT_KNOWN_PROBLEM sans candidatePointId reste hors candidat — rail null => source dédiée', () => {
    const orphanRow: PendingIdentityCandidateRow = {
      id: 'candidate-orphan',
      siteId: 'site-1',
      candidateTraceThreadId: 'thread-orphan-1',
      candidatePointId: 'point-confirmed-existing',
      reason: 'résolution documentaire confirmée par un humain comme refermant ce Point',
      rail: null,
      status: 'pending',
    }
    const [projected] = projectPendingIdentityCandidates([orphanRow])
    expect(projected.source).toBe('resolution_without_known_problem')
  })
})
