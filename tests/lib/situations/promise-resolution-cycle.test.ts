// T5 — cycle complet : promesse visible → geste → signal absent + historique.
// Prouve les 4 gestes × 2 tables en traversant la pile entière :
//   getStructuredPromiseRecords → detectPromiseSignalsFromRecords → (1 signal)
//   → mutation → getStructuredPromiseRecords → detectPromiseSignalsFromRecords → (0 signal)
//   → la ligne terminale est toujours en base (historique consultable).
//
// createFollowUp n'est PAS un geste de résolution : le signal reste, la promesse
// reste active, seule une action de suivi est créée.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectPromiseSignalsFromRecords } from '@/lib/memory/signals/promise-pipeline'
import { getStructuredPromiseRecords } from '@/lib/db/promise-candidates'
import { fulfillPromise, cancelPromise, replacePromise, createPromiseFollowUp } from '@/lib/db/promise-resolution'

// QB étendu : supporte .in() pour les requêtes multi-tenant de getStructuredPromiseRecords.
type Row = Record<string, unknown> & { id: string; organization_id: string; site_id: string; status: string }
let store: Record<string, Row[]>
let idSeq: number
const invalidated: string[] = []
const createdActions: Array<Record<string, unknown>> = []

class QB {
  private op: string | null = null
  private payload: Record<string, unknown> | null = null
  private filters: Array<(r: Row) => boolean> = []

  constructor(private table: string) {}

  select() { if (!this.op) this.op = 'select'; return this }
  insert(obj: Record<string, unknown>) { this.op = 'insert'; this.payload = obj; return this }
  update(patch: Record<string, unknown>) { this.op = 'update'; this.payload = patch; return this }
  delete() { this.op = 'delete'; return this }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this }
  in(col: string, vals: unknown[]) { this.filters.push((r) => Array.isArray(vals) && vals.includes(r[col])); return this }

  private match(r: Row) { return this.filters.every((f) => f(r)) }

  async maybeSingle() { return { data: store[this.table].find((r) => this.match(r)) ?? null, error: null } }
  async single() {
    const id = `new-${++idSeq}`
    const row = { id, ...(this.payload ?? {}) } as Row
    store[this.table].push(row)
    return { data: { id }, error: null }
  }
  then(resolve: (v: { data: unknown; error: null }) => unknown) { return Promise.resolve(resolve(this.run())) }
  private run() {
    if (this.op === 'update') {
      const affected = store[this.table].filter((r) => this.match(r))
      affected.forEach((r) => Object.assign(r, this.payload))
      return { data: affected.map((r) => ({ site_id: r.site_id })), error: null }
    }
    if (this.op === 'delete') {
      store[this.table] = store[this.table].filter((r) => !this.match(r))
      return { data: null, error: null }
    }
    return { data: store[this.table].filter((r) => this.match(r)), error: null }
  }
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => new QB(t) }) }))
vi.mock('@/lib/knowledge/invalidate', () => ({ invalidateSiteProjection: (s: string) => invalidated.push(s) }))
vi.mock('@/lib/db/site-actions', () => ({ createSiteAction: async (i: Record<string, unknown>) => { createdActions.push(i); return 'action-1' } }))

const NOW = '2026-07-28T08:00:00.000Z'
const ORG = 'org-1'
const USER = 'user-1'
const capturedSubject = { table: 'captured_knowledge' as const, id: 'cap-1', organizationId: ORG, siteId: 'site-1' }
const proposalSubject = { table: 'site_knowledge_proposals' as const, id: 'prop-1', organizationId: ORG, siteId: 'site-1' }

// captured_knowledge : dueAt est toujours null → signal via needs-confirmation
// (occurredAt = 8 jours avant NOW, donc > FOLLOW_UP_AFTER_DAYS=7).
function seedCaptured(status = 'active') {
  store.captured_knowledge.push({
    id: 'cap-1', organization_id: ORG, site_id: 'site-1',
    status, kind: 'promise',
    title: 'Le planning sera diffusé vendredi.',
    source_type: 'visit', source_id: 'visit-1',
    created_at: '2026-07-20T09:00:00.000Z',
    body: null,
  })
}

// site_knowledge_proposals : payload.dueAt dans le passé → signal via expired.
function seedProposal(status = 'proposed') {
  store.site_knowledge_proposals.push({
    id: 'prop-1', organization_id: ORG, site_id: 'site-1',
    status, kind: 'deadline',
    title: 'Livraison planning confirmée.',
    report_id: 'visit-1', promoted_object_id: null,
    payload: { commitment: true, dueAt: '2026-07-21T23:59:59Z' },
    source_capture_ids: [], dedupe_key: null,
    created_at: '2026-07-20T09:00:00.000Z',
    body: null,
  })
}

const row = (t: string, id: string) => store[t].find((r) => r.id === id)!

async function readSignals() {
  const records = await getStructuredPromiseRecords([ORG])
  return detectPromiseSignalsFromRecords(records, NOW)
}

beforeEach(() => {
  store = { captured_knowledge: [], site_knowledge_proposals: [] }
  idSeq = 0
  invalidated.length = 0
  createdActions.length = 0
})

// ---------------------------------------------------------------------------
// FULFILL
// ---------------------------------------------------------------------------
describe('fulfill — signal disparaît, ligne terminale préservée', () => {
  it('captured_knowledge : 1 signal → fulfill → 0 signal, row resolved', async () => {
    seedCaptured()
    expect(await readSignals()).toHaveLength(1)

    const r = await fulfillPromise({ subject: capturedSubject, userId: USER, allowedOrgIds: [ORG] })
    expect(r.status).toBe('resolved')

    expect(await readSignals()).toHaveLength(0)
    expect(row('captured_knowledge', 'cap-1').status).toBe('resolved')
  })

  it('site_knowledge_proposals : 1 signal → fulfill → 0 signal, row fulfilled', async () => {
    seedProposal()
    expect(await readSignals()).toHaveLength(1)

    const r = await fulfillPromise({ subject: proposalSubject, userId: USER, allowedOrgIds: [ORG] })
    expect(r.status).toBe('resolved')

    expect(await readSignals()).toHaveLength(0)
    expect(row('site_knowledge_proposals', 'prop-1').status).toBe('fulfilled')
  })
})

// ---------------------------------------------------------------------------
// CANCEL
// ---------------------------------------------------------------------------
describe('cancel — signal disparaît, ligne dismissed avec motif', () => {
  it('captured_knowledge : 1 signal → cancel → 0 signal, row dismissed', async () => {
    seedCaptured()
    expect(await readSignals()).toHaveLength(1)

    await cancelPromise({ subject: capturedSubject, userId: USER, allowedOrgIds: [ORG], reason: 'Plus attendue' })

    expect(await readSignals()).toHaveLength(0)
    const r = row('captured_knowledge', 'cap-1')
    expect(r.status).toBe('dismissed')
    expect(r.dismiss_reason).toBe('Plus attendue')
  })

  it('site_knowledge_proposals : 1 signal → cancel → 0 signal, row dismissed', async () => {
    seedProposal()
    expect(await readSignals()).toHaveLength(1)

    await cancelPromise({ subject: proposalSubject, userId: USER, allowedOrgIds: [ORG] })

    expect(await readSignals()).toHaveLength(0)
    expect(row('site_knowledge_proposals', 'prop-1').status).toBe('dismissed')
  })
})

// ---------------------------------------------------------------------------
// REPLACE
// ---------------------------------------------------------------------------
describe('replace — ancien signal disparaît, ancienne terminale, remplaçante créée', () => {
  it('captured_knowledge : 1 signal → replace → 0 signal, ancienne obsolete, remplaçante en base', async () => {
    seedCaptured()
    expect(await readSignals()).toHaveLength(1)

    const r = await replacePromise({ subject: capturedSubject, userId: USER, allowedOrgIds: [ORG], replacement: { title: 'Diffusion reportée à mardi' } })
    expect(r.status).toBe('resolved')
    const newId = (r as { replacementId: string }).replacementId

    // Plus de signal : l'ancienne est obsolete (terminal), la remplaçante
    // n'a pas de source_id → exclue du read model en V1.
    expect(await readSignals()).toHaveLength(0)
    expect(row('captured_knowledge', 'cap-1').status).toBe('obsolete')
    expect(row('captured_knowledge', newId)).toBeDefined()
    expect(invalidated).toContain('site-1')
  })

  it('site_knowledge_proposals : 1 signal → replace → 0 signal, ancienne superseded, remplaçante en base', async () => {
    seedProposal()
    expect(await readSignals()).toHaveLength(1)

    const r = await replacePromise({ subject: proposalSubject, userId: USER, allowedOrgIds: [ORG], replacement: { title: 'Nouvelle livraison semaine 32' } })
    expect(r.status).toBe('resolved')
    const newId = (r as { replacementId: string }).replacementId

    expect(await readSignals()).toHaveLength(0)
    expect(row('site_knowledge_proposals', 'prop-1').status).toBe('superseded')
    expect(row('site_knowledge_proposals', newId)).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// CREATE FOLLOW-UP (geste non résolutif)
// ---------------------------------------------------------------------------
describe('createFollowUp — signal RESTE, promesse active, action créée', () => {
  it('captured_knowledge : 1 signal → followUp → toujours 1 signal, promesse active', async () => {
    seedCaptured()
    expect(await readSignals()).toHaveLength(1)

    const r = await createPromiseFollowUp({ subject: capturedSubject, userId: USER, allowedOrgIds: [ORG], title: "Relancer le bureau d'études" })
    expect(r.status).toBe('created')

    // La promesse reste active → toujours visible dans le read model.
    expect(await readSignals()).toHaveLength(1)
    expect(row('captured_knowledge', 'cap-1').status).toBe('active')
    expect(createdActions).toHaveLength(1)
  })

  it('site_knowledge_proposals : 1 signal → followUp → toujours 1 signal, proposition active', async () => {
    seedProposal()
    expect(await readSignals()).toHaveLength(1)

    await createPromiseFollowUp({ subject: proposalSubject, userId: USER, allowedOrgIds: [ORG], title: 'Rappel planning' })

    expect(await readSignals()).toHaveLength(1)
    expect(row('site_knowledge_proposals', 'prop-1').status).toBe('proposed')
  })
})
