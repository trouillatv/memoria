import { describe, expect, it } from 'vitest'
import {
  buildSubjectPointMiniContext,
  loadSubjectPointMiniContext,
} from '@/lib/knowledge/tracked-point-subject-context'
import type { PointEvidenceLookups, TrackedPointRow } from '@/lib/knowledge/tracked-point-read-model'

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

const emptyLookups = (): PointEvidenceLookups => ({
  cboIdsByPoint: new Map(),
  cboReduced: new Map(),
  threadsByPoint: new Map(),
  membersByPoint: new Map(),
  proposalsByThread: new Map(),
  proposalById: new Map(),
  docDate: new Map(),
})

// Câble threadsByPoint/membersByPoint/proposalsByThread/proposalById/docDate pour UN point,
// mêmes familles/statuts que la bridge documentaire déjà gelée (tracked-point-read-model.test.ts) —
// jamais un second vocabulaire d'événements.
function wireDocsForPoint(
  pointId: string,
  entries: Array<{ family: string; status: string; date: string }>,
  lookups: PointEvidenceLookups,
): void {
  const threadId = `${pointId}-thread`
  lookups.threadsByPoint.set(pointId, [threadId])
  lookups.membersByPoint.set(pointId, [
    { subjectThreadId: threadId, scope: 'thread', proposalIds: null, status: 'active' },
  ])
  const proposalIds: string[] = []
  entries.forEach((e, i) => {
    const proposalId = `${pointId}-prop-${i}`
    const docId = `${pointId}-doc-${i}`
    proposalIds.push(proposalId)
    lookups.proposalById.set(proposalId, {
      id: proposalId,
      subject_thread_id: threadId,
      proposal_family: e.family,
      document_status: e.status,
      document_id: docId,
    })
    lookups.docDate.set(docId, e.date)
  })
  lookups.proposalsByThread.set(threadId, proposalIds)
}

const wireOpen = (pointId: string, lookups: PointEvidenceLookups) =>
  wireDocsForPoint(pointId, [{ family: 'action', status: 'open', date: '2026-01-01' }], lookups)

const wireResolved = (pointId: string, lookups: PointEvidenceLookups) =>
  wireDocsForPoint(pointId, [{ family: 'knowledge_fact', status: 'done', date: '2026-01-10' }], lookups)

const wireReopened = (pointId: string, lookups: PointEvidenceLookups) =>
  wireDocsForPoint(
    pointId,
    [
      { family: 'action', status: 'open', date: '2026-01-01' },
      { family: 'knowledge_fact', status: 'done', date: '2026-02-01' },
      { family: 'action', status: 'open', date: '2026-03-01' },
    ],
    lookups,
  )

describe('tracked-point-subject-context — buildSubjectPointMiniContext', () => {
  it('sujet avec plusieurs Points ouverts — la tally les compte tous, aucune agrégation ne les fusionne', () => {
    const lookups = emptyLookups()
    const points = ['p1', 'p2', 'p3'].map((id) => basePoint({ id }))
    points.forEach((p) => wireOpen(p.id, lookups))

    const ctx = buildSubjectPointMiniContext('subject-1', 'p1', points, false, lookups)

    expect(ctx.totalPoints).toBe(3)
    expect(ctx.open).toBe(3)
    expect(ctx.resolved).toBe(0)
    expect(ctx.crossSubjectMergeDetected).toBe(false)
    expect(ctx.points).toHaveLength(3)
  })

  it('mix ouvert/résolu/réouvert — chaque état est compté indépendamment, sans collapse', () => {
    const lookups = emptyLookups()
    const open = basePoint({ id: 'p-open' })
    const resolved = basePoint({ id: 'p-resolved' })
    const reopened = basePoint({ id: 'p-reopened' })
    wireOpen(open.id, lookups)
    wireResolved(resolved.id, lookups)
    wireReopened(reopened.id, lookups)

    const ctx = buildSubjectPointMiniContext('subject-1', 'p-open', [open, resolved, reopened], false, lookups)

    expect(ctx.totalPoints).toBe(3)
    expect(ctx.open).toBe(1)
    expect(ctx.resolved).toBe(1)
    expect(ctx.reopened).toBe(1)
    // Tri d'affichage réutilisé tel quel (sortPointsForSubjectDisplay) : réouvert avant ouvert avant résolu.
    expect(ctx.points.map((p) => p.id)).toEqual(['p-reopened', 'p-open', 'p-resolved'])
  })

  it('le Point courant est identifié par isCurrent, et lui seul', () => {
    const lookups = emptyLookups()
    const a = basePoint({ id: 'p-a' })
    const b = basePoint({ id: 'p-b' })
    const c = basePoint({ id: 'p-c' })
    ;[a, b, c].forEach((p) => wireOpen(p.id, lookups))

    const ctx = buildSubjectPointMiniContext('subject-1', 'p-b', [a, b, c], false, lookups)

    const current = ctx.points.filter((p) => p.isCurrent)
    expect(current).toHaveLength(1)
    expect(current[0].id).toBe('p-b')
  })

  it('sujet avec un seul Point — le mini-contexte reste cohérent (pas de division par zéro, pas de liste vide)', () => {
    const lookups = emptyLookups()
    const solo = basePoint({ id: 'solo' })
    wireResolved(solo.id, lookups)

    const ctx = buildSubjectPointMiniContext('subject-1', 'solo', [solo], false, lookups)

    expect(ctx.totalPoints).toBe(1)
    expect(ctx.points).toHaveLength(1)
    expect(ctx.points[0].isCurrent).toBe(true)
    expect(ctx.points[0].derivedState).toBe('resolved')
  })

  it('absence de sujet — le wrapper IO renvoie null sans effectuer la moindre requête', async () => {
    const result = await loadSubjectPointMiniContext('site-1', null, 'point-orphelin')
    expect(result).toBeNull()
  })

  it('fusion — même sujet agrège normalement ; fusion cross-sujet dégrade en singletons et le signale', () => {
    // Cas A — fusion À L'INTÉRIEUR du même sujet (canonique + membre merged tous deux dans `points`) :
    // le canonique agrège l'évidence des deux, le membre merged n'apparaît jamais séparément.
    const lookupsSameSubject = emptyLookups()
    const canonical = basePoint({ id: 'p-canonical' })
    const mergedIntoCanonical = basePoint({ id: 'p-merged-same-subject', status: 'merged', mergedIntoId: 'p-canonical' })
    wireOpen('p-canonical', lookupsSameSubject)
    wireResolved('p-merged-same-subject', lookupsSameSubject)

    const sameSubjectCtx = buildSubjectPointMiniContext(
      'subject-1',
      'p-canonical',
      [canonical, mergedIntoCanonical],
      false,
      lookupsSameSubject,
    )
    expect(sameSubjectCtx.crossSubjectMergeDetected).toBe(false)
    expect(sameSubjectCtx.points.map((p) => p.id)).toEqual(['p-canonical'])
    expect(sameSubjectCtx.points[0].hardMemberThreadIds).toContain('p-merged-same-subject-thread')

    // Cas B — fusion SORTANTE : un Point de ce sujet fusionne vers un id absent de la population
    // scopée (forcément un autre sujet). Dégradation globale : chaque Point redevient un singleton,
    // jamais d'agrégation partielle/incohérente (buildPointMergeComponents ne doit jamais être
    // appelé avec une cible de fusion manquante).
    const lookupsOutgoing = emptyLookups()
    const stayingPoint = basePoint({ id: 'p-staying' })
    const outgoingMerged = basePoint({ id: 'p-outgoing', status: 'merged', mergedIntoId: 'external-point-other-subject' })
    wireOpen('p-staying', lookupsOutgoing)

    const outgoingCtx = buildSubjectPointMiniContext(
      'subject-1',
      'p-staying',
      [stayingPoint, outgoingMerged],
      false,
      lookupsOutgoing,
    )
    expect(outgoingCtx.crossSubjectMergeDetected).toBe(true)
    // p-outgoing reste status='merged' → jamais réaffiché séparément, mais son évidence n'est plus
    // agrégée dans un canonique (il n'est pas de ce sujet) : seul p-staying (non-merged) apparaît.
    expect(outgoingCtx.points.map((p) => p.id)).toEqual(['p-staying'])

    // Cas C — fusion ENTRANTE : détectée en amont par l'appelant (requête étroite), transmise via
    // incomingCrossDetected. Même dégradation globale, même si aucun mergedIntoId ne sort de la
    // population locale.
    const lookupsIncoming = emptyLookups()
    const soleOwn = basePoint({ id: 'p-sole-own' })
    wireOpen('p-sole-own', lookupsIncoming)
    const incomingCtx = buildSubjectPointMiniContext('subject-1', 'p-sole-own', [soleOwn], true, lookupsIncoming)
    expect(incomingCtx.crossSubjectMergeDetected).toBe(true)
    expect(incomingCtx.points.map((p) => p.id)).toEqual(['p-sole-own'])
  })
})
