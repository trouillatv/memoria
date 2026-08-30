// D2 — Tests read-model du Débrief vivant (buildLiveDebrief)
//
// Cas couverts (spec D2 §10) :
//  1. Action open → to_handle
//  2. Action planned → to_watch
//  3. Action done récent → recently_handled
//  4. Action cancelled → hors actif (handled_without_reliable_date, invisible)
//  5. Deadline to_plan → to_handle
//  6. Deadline planned → to_watch
//  7. Deadline terminale sans resolvedAt → pas recently_handled daté
//  8. Reserve open → to_handle
//  9. Reserve lifted récent → recently_handled
// 10. Planning item → jamais to_handle/to_watch (garde-fou structurel D1)
// 11. Signal info unseen → to_watch + markSeen possible
// 12. Signal info lié à un objet ouvert → pas de doublon
// 13. Objet sans canonical_subject → toujours visible
// 14. Canonical subject seul (aucun objet ouvert) → jamais to_handle
// 15. First visit (aucune visite terrain terminée)
// 16. Activité récente regroupée par visite (pass-through de getSiteRecentActivity)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  classifyPlanningItemForDebrief,
  debriefBlockForDisposition,
  markSeen,
  type DebriefInformationalSignalItem,
} from '@/lib/knowledge/debrief-contract'
import type { CanonicalAttentionItem } from '@/lib/knowledge/canonical-attention'
import type { SiteActivityItem } from '@/lib/db/visits'
import type { SiteOverview } from '@/lib/knowledge/site-overview'

const TODAY = '2026-08-31'

// ── Mocks des sources composées ──────────────────────────────────────────────

const overviewMock = vi.fn()
const sinceDeltaMock = vi.fn()
const recentActivityMock = vi.fn()
const canonicalItemsMock = vi.fn()

vi.mock('@/lib/knowledge/site-overview', () => ({
  getSiteOverview: (...args: unknown[]) => overviewMock(...args),
}))
vi.mock('@/lib/db/visits', () => ({
  buildSinceLastVisitDelta: (...args: unknown[]) => sinceDeltaMock(...args),
  getSiteRecentActivity: (...args: unknown[]) => recentActivityMock(...args),
}))
vi.mock('@/lib/knowledge/canonical-attention', () => ({
  deriveCanonicalAttentionItems: (...args: unknown[]) => canonicalItemsMock(...args),
}))

type TableData = Record<string, unknown[]>
let adminTables: TableData = {}

function chainable(data: unknown[]) {
  const self: PromiseLike<{ data: unknown[]; error: null }> & Record<string, unknown> = {
    select: () => self,
    eq: () => self,
    is: () => self,
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data, error: null }),
  } as never
  return self
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => chainable(adminTables[table] ?? []),
  }),
}))

// Import après les mocks (convention vitest).
const { buildLiveDebrief, actionToItem, deadlineToItem, reserveToItem, informationalItems } = await import('@/lib/knowledge/live-debrief')

function baseOverview(overrides: Partial<{
  active: number; overdue: number; toPlan: number; planned: number; reservesOpen: number
}> = {}): SiteOverview {
  const o = { active: 0, overdue: 0, toPlan: 0, planned: 0, reservesOpen: 0, ...overrides }
  return {
    identity: { id: 'site-1', name: 'Chantier', client: null, status: null },
    activity: { lastVisit: null, picture: null },
    synthesis: { status: 'missing', version: null, updatedAt: null, basedOn: null, pendingChanges: 0, pending: { photos: 0, videos: 0, vocals: 0, notes: 0 }, projectionFailed: false },
    actions: { proposed: [], confirmed: [], completedRecent: [], priority: [], summary: { proposed: 0, active: o.active, planned: 0, overdue: o.overdue, week: 0, undated: 0, completed: 0 } },
    attention: { level: 'calm', reasons: [] },
    nextEvent: null,
    recentChanges: [],
    reserves: { open: o.reservesOpen },
    blockages: { open: 0 },
    watchpoints: { proposed: [], confirmed: [], summary: { proposed: 0, confirmed: 0 } },
    deadlines: { proposed: [], confirmed: [], summary: { proposed: 0, confirmed: 0 } },
    deadlineCounts: { toPlan: o.toPlan, planned: o.planned },
    stakeholders: { proposed: [], confirmed: [], summary: { proposed: 0, confirmed: 0 } },
    stakeholderCompanies: [],
    knowledge: { proposed: [], confirmed: [], summary: { proposed: 0, confirmed: 0 } },
    decisions: { proposed: [], confirmed: [], summary: { proposed: 0, confirmed: 0 } },
    history: [],
    pvAttention: [],
    pvLastDelta: null,
    pvActivity: null,
    pvToVerify: [],
  }
}

function makeCanonicalItem(overrides: Partial<CanonicalAttentionItem> = {}): CanonicalAttentionItem {
  return {
    canonicalSubjectId: 'cs-1',
    title: 'Sujet',
    urgency: 'high',
    score: 80,
    signals: ['stagnant'],
    reasons: ['Sans évolution depuis 60j'],
    href: '/sites/site-1/historique/sujets/cs-1',
    ...overrides,
  }
}

beforeEach(() => {
  adminTables = {}
  overviewMock.mockReset().mockResolvedValue(baseOverview())
  sinceDeltaMock.mockReset().mockResolvedValue(null)
  recentActivityMock.mockReset().mockResolvedValue([])
  canonicalItemsMock.mockReset().mockResolvedValue([])
})

// ── Items purs (1-9, 13) ──────────────────────────────────────────────────────

describe('actionToItem', () => {
  it('open → to_handle', () => {
    const item = actionToItem({ id: 'a1', title: 'Reprise enrobé', status: 'open', due_date: null, done_at: null, canonical_subject_id: null, report_id: null }, TODAY, 'site-1')
    expect(item.disposition).toBe('to_handle')
    expect(debriefBlockForDisposition(item.disposition)).toBe('to_handle')
  })

  it('planned → to_watch', () => {
    const item = actionToItem({ id: 'a2', title: 'Contrôle VRD', status: 'planned', due_date: '2026-09-05', done_at: null, canonical_subject_id: null, report_id: null }, TODAY, 'site-1')
    expect(item.disposition).toBe('to_watch')
  })

  it('done récent → recently_handled avec la date de réalisation', () => {
    const item = actionToItem({ id: 'a3', title: 'Nettoyage base vie', status: 'done', due_date: null, done_at: '2026-08-29T00:00:00.000Z', canonical_subject_id: null, report_id: null }, TODAY, 'site-1')
    expect(item.disposition).toBe('recently_handled')
    expect(item.date).toBe('2026-08-29T00:00:00.000Z')
  })

  it('cancelled sans date → hors actif, jamais recently_handled', () => {
    const item = actionToItem({ id: 'a4', title: 'Action annulée', status: 'cancelled', due_date: null, done_at: null, canonical_subject_id: null, report_id: null }, TODAY, 'site-1')
    expect(item.disposition).toBe('handled_without_reliable_date')
    expect(debriefBlockForDisposition(item.disposition)).toBeNull()
  })

  it('objet sans canonical_subject_id reste classifié normalement (object-first)', () => {
    const item = actionToItem({ id: 'a5', title: 'Action manuelle', status: 'open', due_date: null, done_at: null, canonical_subject_id: null, report_id: null }, TODAY, 'site-1')
    expect(item.canonicalSubjectId).toBeNull()
    expect(debriefBlockForDisposition(item.disposition)).toBe('to_handle')
  })
})

describe('deadlineToItem', () => {
  it('to_plan → to_handle', () => {
    const item = deadlineToItem({ id: 'd1', title: 'Réception G3', status: 'to_plan', due_date: null, completed_at: null, cancelled_at: null, canonical_subject_id: null, report_id: null }, TODAY, 'site-1')
    expect(item.disposition).toBe('to_handle')
  })

  it('planned → to_watch', () => {
    const item = deadlineToItem({ id: 'd2', title: 'Livraison matériaux', status: 'planned', due_date: '2026-09-10', completed_at: null, cancelled_at: null, canonical_subject_id: null, report_id: null }, TODAY, 'site-1')
    expect(item.disposition).toBe('to_watch')
  })

  it('done avec completed_at → recently_handled (correction : le timestamp existe réellement, cf. lib/db/site-deadlines.ts)', () => {
    const item = deadlineToItem({ id: 'd3', title: 'Réception provisoire', status: 'done', due_date: '2026-08-20', completed_at: '2026-08-30T00:00:00.000Z', cancelled_at: null, canonical_subject_id: null, report_id: null }, TODAY, 'site-1')
    expect(item.disposition).toBe('recently_handled')
    expect(item.date).toBe('2026-08-30T00:00:00.000Z')
  })

  it('terminale sans resolvedAt (completed_at ET cancelled_at absents) → jamais recently_handled daté', () => {
    const item = deadlineToItem({ id: 'd4', title: 'Échéance orpheline', status: 'done', due_date: null, completed_at: null, cancelled_at: null, canonical_subject_id: null, report_id: null }, TODAY, 'site-1')
    expect(item.disposition).toBe('handled_without_reliable_date')
    expect(debriefBlockForDisposition(item.disposition)).toBeNull()
  })
})

describe('reserveToItem', () => {
  it('open → to_handle', () => {
    const item = reserveToItem({ id: 'r1', label: 'Fissure façade', status: 'open', issued_on: '2026-08-01', lifted_at: null, canonical_subject_id: null, report_id: null }, TODAY, 'site-1')
    expect(item.disposition).toBe('to_handle')
  })

  it('lifted récent → recently_handled avec lifted_at', () => {
    const item = reserveToItem({ id: 'r2', label: 'Reprise étanchéité', status: 'lifted', issued_on: '2026-07-01', lifted_at: '2026-08-28T00:00:00.000Z', canonical_subject_id: null, report_id: null }, TODAY, 'site-1')
    expect(item.disposition).toBe('recently_handled')
    expect(item.date).toBe('2026-08-28T00:00:00.000Z')
  })
})

// ── Signal informationnel (11, 12, 14) ────────────────────────────────────────

describe('informationalItems', () => {
  it('unseen sans objet lié → to_watch, et markSeen fait passer en recently_handled', () => {
    const items = informationalItems([makeCanonicalItem({ canonicalSubjectId: 'cs-1', signals: ['stagnant'] })], new Set())
    expect(items).toHaveLength(1)
    expect(items[0].disposition).toBe('to_watch')
    expect(items[0].ack).toBe('unseen')

    const seen = markSeen(items[0] as DebriefInformationalSignalItem)
    expect(seen.disposition).toBe('recently_handled')
    expect(seen.ack).toBe('seen')
  })

  it('sujet déjà porté par un objet ouvert → pas de doublon (exclu)', () => {
    const items = informationalItems(
      [makeCanonicalItem({ canonicalSubjectId: 'cs-open', signals: ['stagnant'] })],
      new Set(['cs-open']),
    )
    expect(items).toHaveLength(0)
  })

  it('signal purement opérationnel (action_overdue/deadline_near seuls) → exclu car déjà représenté par l’objet', () => {
    const items = informationalItems(
      [makeCanonicalItem({ canonicalSubjectId: 'cs-op', signals: ['action_overdue'] })],
      new Set(),
    )
    expect(items).toHaveLength(0)
  })

  it('signal mixte (trajectoire + opérationnel) reste admissible', () => {
    const items = informationalItems(
      [makeCanonicalItem({ canonicalSubjectId: 'cs-mix', signals: ['stagnant', 'action_overdue'] })],
      new Set(),
    )
    expect(items).toHaveLength(1)
  })

  it('garde-fou : un signal canonical seul ne peut jamais produire to_handle, quelle que soit l’urgence', () => {
    const items = informationalItems(
      [makeCanonicalItem({ canonicalSubjectId: 'cs-critical', urgency: 'critical', score: 100, signals: ['stagnant_blocking'] })],
      new Set(),
    )
    expect(items.every((i) => i.disposition !== 'to_handle')).toBe(true)
  })
})

// ── Planning (10) ──────────────────────────────────────────────────────────────

it('un item Planning ne rejoint jamais to_handle/to_watch (garde-fou D1 structurel)', () => {
  const item = classifyPlanningItemForDebrief()
  expect(debriefBlockForDisposition(item.disposition)).toBeNull()
})

// ── buildLiveDebrief (intégration : object-first, dédup, first_visit, activité) ─

describe('buildLiveDebrief', () => {
  it('objet sans canonical_subject_id reste visible dans to_handle (object-first)', async () => {
    adminTables = {
      site_actions: [{ id: 'a1', title: 'Action manuelle', status: 'open', due_date: null, done_at: null, canonical_subject_id: null, report_id: null }],
      site_deadlines: [],
      site_reserve: [],
    }
    const result = await buildLiveDebrief('site-1')
    expect(result.toHandle.some((i) => i.kind !== 'informational_signal' && i.id === 'a1')).toBe(true)
  })

  it('dédup : signal informationnel absent quand un objet ouvert porte déjà le même sujet, sans faire disparaître l’objet lui-même', async () => {
    adminTables = {
      site_actions: [{ id: 'a1', title: 'Action liée', status: 'open', due_date: null, done_at: null, canonical_subject_id: 'cs-1', report_id: null }],
      site_deadlines: [],
      site_reserve: [],
    }
    canonicalItemsMock.mockResolvedValue([makeCanonicalItem({ canonicalSubjectId: 'cs-1', signals: ['stagnant'] })])
    const result = await buildLiveDebrief('site-1')
    expect(result.toHandle.some((i) => i.kind === 'action' && i.id === 'a1')).toBe(true)
    expect(result.toWatch.some((i) => i.kind === 'informational_signal')).toBe(false)
  })

  it('canonical subject actif sans objet ouvert (action déjà done) → jamais recréer to_handle', async () => {
    adminTables = {
      site_actions: [{ id: 'a1', title: 'Action déjà traitée', status: 'done', due_date: null, done_at: '2020-01-01T00:00:00.000Z', canonical_subject_id: 'cs-1', report_id: null }],
      site_deadlines: [],
      site_reserve: [],
    }
    canonicalItemsMock.mockResolvedValue([makeCanonicalItem({ canonicalSubjectId: 'cs-1', urgency: 'critical', signals: ['stagnant_blocking'] })])
    const result = await buildLiveDebrief('site-1')
    expect(result.toHandle).toHaveLength(0)
  })

  it('first_visit explicite quand aucune visite terrain terminée n’existe', async () => {
    sinceDeltaMock.mockResolvedValue(null)
    const result = await buildLiveDebrief('site-1')
    expect(result.sinceLastVisit).toEqual({ kind: 'first_visit' })
  })

  it('avec une visite de référence, since_last_visit porte le delta réel', async () => {
    sinceDeltaMock.mockResolvedValue({ at: '2026-08-20', visitDateLabel: '20 août', daysAgo: 11, personal: true, items: [], overflow: 0 })
    const result = await buildLiveDebrief('site-1', 'user-1')
    expect(result.sinceLastVisit).toEqual({ kind: 'delta', at: '2026-08-20', visitDateLabel: '20 août', daysAgo: 11, personal: true, items: [], overflow: 0 })
  })

  it('activité récente = pass-through de getSiteRecentActivity (déjà groupée par visite)', async () => {
    const activity: SiteActivityItem[] = [
      { kind: 'visit', label: 'Visite terrain', dateLabel: '28 août', at: '2026-08-28T10:00:00.000Z', href: '/sites/site-1/visites/r1', reportId: 'r1', detail: '12 photos' },
    ]
    recentActivityMock.mockResolvedValue(activity)
    const result = await buildLiveDebrief('site-1')
    expect(result.recentActivity).toEqual(activity)
  })

  it('confirmed_today reprend les compteurs de getSiteOverview sans nouvelle définition', async () => {
    overviewMock.mockResolvedValue(baseOverview({ active: 4, overdue: 1, toPlan: 2, planned: 3, reservesOpen: 5 }))
    const result = await buildLiveDebrief('site-1')
    expect(result.confirmedToday).toEqual({
      actionsActive: 4,
      actionsOverdue: 1,
      deadlinesToPlan: 2,
      deadlinesPlanned: 3,
      reservesOpen: 5,
      nextEvent: null,
    })
  })
})
