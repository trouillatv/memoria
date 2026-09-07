import { describe, expect, it } from 'vitest'
import {
  projectTrackedPoint,
  deriveSubjectPointReadModel,
  projectPendingIdentityCandidates,
  selectEligibleProposalIds,
  assemblePointDocumentaryEvents,
  type TrackedPointRow,
  type PendingIdentityCandidateRow,
  type PointMembershipRow,
  type PointDocProposalProvenance,
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
  createdAt: '2026-01-01T00:00:00.000Z',
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

describe('tracked-point-read-model — bridge HARD membership → événements documentaires (6B.1)', () => {
  const proposal = (over: Partial<PointDocProposalProvenance> = {}): PointDocProposalProvenance => ({
    proposalId: 'proposal-1',
    proposalFamily: 'knowledge_fact',
    documentStatus: 'done',
    date: '2026-01-10',
    ...over,
  })

  it('F8 — sans membership la preuve est ignorée ; avec membership HARD elle est consommée, et un CBO natif resté open produit une divergence', () => {
    const proposalsByThread = new Map([['thread-1', ['proposal-1']]])
    const point = basePoint({ id: 'f8-bridge' })

    const noMembers: PointMembershipRow[] = []
    const eligibleWithout = selectEligibleProposalIds(noMembers, proposalsByThread)
    expect(eligibleWithout.size).toBe(0)
    const docsWithout = assemblePointDocumentaryEvents([proposal()].filter((p) => eligibleWithout.has(p.proposalId)))
    expect(docsWithout).toEqual([])
    const openEntry = projectTrackedPoint(point, [cbo('open')], [], [], docsWithout)
    expect(openEntry.derivedState).toBe('open')
    expect(openEntry.hasDocumentaryDivergence).toBe(false)

    const members: PointMembershipRow[] = [
      { subjectThreadId: 'thread-1', scope: 'thread', proposalIds: null, status: 'active' },
    ]
    const eligibleWith = selectEligibleProposalIds(members, proposalsByThread)
    expect(eligibleWith.has('proposal-1')).toBe(true)
    const docsWith = assemblePointDocumentaryEvents([proposal()])
    expect(docsWith).toEqual([
      { kind: 'resolution_signal', attestedAt: '2026-01-10', eventAt: '2026-01-10', source: 'proposal:proposal-1' },
    ])

    const divergentEntry = projectTrackedPoint(point, [cbo('open')], ['thread-1'], [], docsWith)
    expect(divergentEntry.derivedState).toBe('open')
    expect(divergentEntry.hasDocumentaryDivergence).toBe(true)
  })

  it('proposal_set — deux propositions du même thread, une seule ciblée par le membership, isolation prouvée', () => {
    const proposalsByThread = new Map([['thread-2', ['prop-a', 'prop-b']]])
    const members: PointMembershipRow[] = [
      { subjectThreadId: 'thread-2', scope: 'proposal_set', proposalIds: ['prop-a'], status: 'active' },
    ]
    const eligible = selectEligibleProposalIds(members, proposalsByThread)
    expect(eligible).toEqual(new Set(['prop-a']))
    expect(eligible.has('prop-b')).toBe(false)

    const provenance: PointDocProposalProvenance[] = [
      { proposalId: 'prop-a', proposalFamily: 'knowledge_fact', documentStatus: 'done', date: '2026-02-01' },
      { proposalId: 'prop-b', proposalFamily: 'knowledge_fact', documentStatus: 'done', date: '2026-02-02' },
    ].filter((p) => eligible.has(p.proposalId))
    const docs = assemblePointDocumentaryEvents(provenance)
    expect(docs).toEqual([
      { kind: 'resolution_signal', attestedAt: '2026-02-01', eventAt: '2026-02-01', source: 'proposal:prop-a' },
    ])
  })

  it('retired — un membership status=retired ne contribue jamais, quel que soit son scope', () => {
    const proposalsByThread = new Map([['thread-3', ['prop-c']]])
    const retiredThread: PointMembershipRow[] = [
      { subjectThreadId: 'thread-3', scope: 'thread', proposalIds: null, status: 'retired' },
    ]
    expect(selectEligibleProposalIds(retiredThread, proposalsByThread).size).toBe(0)

    const retiredProposalSet: PointMembershipRow[] = [
      { subjectThreadId: 'thread-3', scope: 'proposal_set', proposalIds: ['prop-c'], status: 'retired' },
    ]
    expect(selectEligibleProposalIds(retiredProposalSet, proposalsByThread).size).toBe(0)
  })

  it('candidate — un candidat pending ou accepted sans tracked_point_member HARD ne modifie jamais la projection', () => {
    const proposalsByThread = new Map([['thread-4', ['prop-d']]])
    const noMembers: PointMembershipRow[] = []
    const eligible = selectEligibleProposalIds(noMembers, proposalsByThread)
    expect(eligible.size).toBe(0)

    const point = basePoint({ id: 'candidate-bridge' })
    const before = projectTrackedPoint(point, [cbo('open')], [], [], [])

    const candidateRows: PendingIdentityCandidateRow[] = [
      {
        id: 'candidate-accepted',
        siteId: 'site-1',
        candidateTraceThreadId: 'thread-4',
        candidatePointId: point.id,
        reason: 'accepté par un humain',
        rail: 'strong_containment',
        status: 'accepted',
      },
    ]
    projectPendingIdentityCandidates(candidateRows) // calculé, jamais consommé ci-dessous

    const provenance: PointDocProposalProvenance[] = [...eligible].map((id) => ({
      proposalId: id,
      proposalFamily: 'knowledge_fact',
      documentStatus: 'done',
      date: '2026-01-01',
    }))
    const after = projectTrackedPoint(point, [cbo('open')], [], [], assemblePointDocumentaryEvents(provenance))
    expect(after).toEqual(before)
  })

  it('trajectory — open_signal puis resolution_signal puis open_signal reconstruisent open → resolved → reopened', () => {
    const provenance: PointDocProposalProvenance[] = [
      { proposalId: 'p-open', proposalFamily: 'action', documentStatus: 'open', date: '2026-01-01' },
      { proposalId: 'p-resolved', proposalFamily: 'knowledge_fact', documentStatus: 'done', date: '2026-02-01' },
      { proposalId: 'p-reopened', proposalFamily: 'action', documentStatus: 'open', date: '2026-03-01' },
    ]
    const docs = assemblePointDocumentaryEvents(provenance)
    expect(docs).toEqual([
      { kind: 'open_signal', attestedAt: '2026-01-01', eventAt: '2026-01-01', source: 'proposal:p-open' },
      { kind: 'resolution_signal', attestedAt: '2026-02-01', eventAt: '2026-02-01', source: 'proposal:p-resolved' },
      { kind: 'open_signal', attestedAt: '2026-03-01', eventAt: '2026-03-01', source: 'proposal:p-reopened' },
    ])

    const point = basePoint({ id: 'trajectory-bridge' })
    const entry = projectTrackedPoint(point, [], [], [], docs)
    expect(entry.derivedState).toBe('reopened')
    expect(entry.trajectory.map((t) => t.kind)).toEqual(['open_signal', 'resolution_signal', 'open_signal'])
  })

  it('déduplication — une même proposition atteinte par deux memberships (thread + proposal_set) ne produit qu\'une seule contribution', () => {
    const proposalsByThread = new Map([['thread-5', ['prop-e']]])
    const members: PointMembershipRow[] = [
      { subjectThreadId: 'thread-5', scope: 'thread', proposalIds: null, status: 'active' },
      { subjectThreadId: 'thread-5', scope: 'proposal_set', proposalIds: ['prop-e'], status: 'active' },
    ]
    const eligible = selectEligibleProposalIds(members, proposalsByThread)
    expect(eligible).toEqual(new Set(['prop-e']))

    const provenance: PointDocProposalProvenance[] = [...eligible].map((id) => ({
      proposalId: id,
      proposalFamily: 'knowledge_fact',
      documentStatus: 'done',
      date: '2026-04-01',
    }))
    // Renforce explicitement : même provenance dupliquée, simulant deux chemins de résolution
    // convergeant vers la même proposition (déduplication sur proposalId, jamais sur texte).
    const withDuplicate = [...provenance, ...provenance]
    const docs = assemblePointDocumentaryEvents(withDuplicate)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toEqual({
      kind: 'resolution_signal',
      attestedAt: '2026-04-01',
      eventAt: '2026-04-01',
      source: 'proposal:prop-e',
    })
  })
})
