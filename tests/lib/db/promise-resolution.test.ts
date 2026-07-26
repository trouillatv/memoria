// T3 — résolution persistante des promesses. On prouve, contre un dépôt mémoire
// simulant Supabase : le bon statut terminal + l'audit (auteur/date) sur CHAQUE
// transition et pour LES DEUX tables ; l'idempotence (pas de double écriture) ;
// la garde d'organisation fail-closed ; et que l'action de suivi ne résout RIEN.

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown> & { id: string; organization_id: string; site_id: string; status: string }
let store: Record<string, Row[]>
let idSeq: number
const invalidated: string[] = []
const createdActions: Array<Record<string, unknown>> = []

class QB {
  op: string | null = null
  payload: Record<string, unknown> | null = null
  filters: Array<[string, unknown]> = []
  constructor(private table: string) {}
  select() { if (!this.op) this.op = 'select'; return this }
  insert(obj: Record<string, unknown>) { this.op = 'insert'; this.payload = obj; return this }
  update(patch: Record<string, unknown>) { this.op = 'update'; this.payload = patch; return this }
  delete() { this.op = 'delete'; return this }
  eq(col: string, val: unknown) { this.filters.push([col, val]); return this }
  private match(r: Row) { return this.filters.every(([c, v]) => r[c] === v) }
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

import { fulfillPromise, cancelPromise, replacePromise, createPromiseFollowUp } from '@/lib/db/promise-resolution'

const ORG = ['org-1']
const capturedSubject = { table: 'captured_knowledge' as const, id: 'cap-1', organizationId: 'org-1', siteId: 'site-1' }
const proposalSubject = { table: 'site_knowledge_proposals' as const, id: 'prop-1', organizationId: 'org-1', siteId: 'site-1' }

function seedCaptured(status = 'active') { store.captured_knowledge.push({ id: 'cap-1', organization_id: 'org-1', site_id: 'site-1', status }) }
function seedProposal(status = 'proposed') { store.site_knowledge_proposals.push({ id: 'prop-1', organization_id: 'org-1', site_id: 'site-1', status }) }
const row = (t: string, id: string) => store[t].find((r) => r.id === id)!

beforeEach(() => {
  store = { captured_knowledge: [], site_knowledge_proposals: [] }
  idSeq = 0
  invalidated.length = 0
  createdActions.length = 0
})

describe('fulfillPromise — RÉALISÉE, avec audit sur les deux tables', () => {
  it('captured_knowledge → resolved + resolved_by + resolved_at', async () => {
    seedCaptured()
    const r = await fulfillPromise({ subject: capturedSubject, userId: 'user-1', allowedOrgIds: ORG })
    expect(r).toEqual({ status: 'resolved', outcome: 'fulfilled', siteId: 'site-1' })
    expect(row('captured_knowledge', 'cap-1')).toMatchObject({ status: 'resolved', resolved_by: 'user-1' })
    expect(row('captured_knowledge', 'cap-1').resolved_at).toBeTruthy()
    expect(invalidated).toEqual(['site-1'])
  })

  it('site_knowledge_proposals → fulfilled + reviewed_by + reviewed_at (aucune promotion)', async () => {
    seedProposal()
    const r = await fulfillPromise({ subject: proposalSubject, userId: 'user-1', allowedOrgIds: ORG })
    expect(r.status).toBe('resolved')
    expect(row('site_knowledge_proposals', 'prop-1')).toMatchObject({ status: 'fulfilled', reviewed_by: 'user-1' })
    expect(row('site_knowledge_proposals', 'prop-1').reviewed_at).toBeTruthy()
    // Aucun objet métier créé.
    expect(row('site_knowledge_proposals', 'prop-1').promoted_object_id).toBeUndefined()
  })
})

describe('cancelPromise — ANNULÉE avec motif', () => {
  it('captured → dismissed + dismiss_reason + auteur/date', async () => {
    seedCaptured()
    await cancelPromise({ subject: capturedSubject, userId: 'user-1', allowedOrgIds: ORG, reason: 'plus attendue' })
    expect(row('captured_knowledge', 'cap-1')).toMatchObject({ status: 'dismissed', dismiss_reason: 'plus attendue', resolved_by: 'user-1' })
    // Point 6 : la date d'audit est posée AUSSI pour un statut terminal 'dismissed'.
    expect(row('captured_knowledge', 'cap-1').resolved_at).toBeTruthy()
  })
})

describe('replacePromise — remplaçante créée dans la MÊME table + lien + terminalisation', () => {
  it('captured → nouvelle promesse active, ancienne obsolete + replaced_by', async () => {
    seedCaptured()
    const r = await replacePromise({ subject: capturedSubject, userId: 'user-1', allowedOrgIds: ORG, replacement: { title: 'Nouvel engagement' } })
    expect(r.status).toBe('resolved')
    const newId = (r as { replacementId: string }).replacementId
    expect(row('captured_knowledge', 'cap-1')).toMatchObject({ status: 'obsolete', replaced_by: newId })
    // Point 6 : audit posé aussi sur 'obsolete'.
    expect(row('captured_knowledge', 'cap-1')).toMatchObject({ resolved_by: 'user-1' })
    expect(row('captured_knowledge', 'cap-1').resolved_at).toBeTruthy()
    // Point 2 : la remplaçante hérite de l'org et du chantier de l'ANCIENNE (rechargés
    // en base), jamais de valeurs fournies par le client.
    expect(row('captured_knowledge', newId)).toMatchObject({
      status: 'active', kind: 'promise', source_type: 'manual', title: 'Nouvel engagement',
      organization_id: 'org-1', site_id: 'site-1',
    })
  })

  it('proposal → nouvelle proposed, ancienne superseded + superseded_by', async () => {
    seedProposal()
    const r = await replacePromise({ subject: proposalSubject, userId: 'user-1', allowedOrgIds: ORG, replacement: { title: 'Nouvelle échéance' } })
    const newId = (r as { replacementId: string }).replacementId
    expect(row('site_knowledge_proposals', 'prop-1')).toMatchObject({ status: 'superseded', superseded_by: newId, reviewed_by: 'user-1' })
    expect(row('site_knowledge_proposals', 'prop-1').reviewed_at).toBeTruthy() // point 6
    expect(row('site_knowledge_proposals', newId)).toMatchObject({ status: 'proposed', kind: 'deadline', organization_id: 'org-1', site_id: 'site-1' })
  })

  it('point 3 — double replace séquentiel : une seule remplaçante, pas deux', async () => {
    seedCaptured()
    expect((await replacePromise({ subject: capturedSubject, userId: 'user-1', allowedOrgIds: ORG, replacement: { title: 'V2' } })).status).toBe('resolved')
    // La 2ᵉ passe voit l'ancienne déjà 'obsolete' → refus, remplaçante non conservée.
    expect((await replacePromise({ subject: capturedSubject, userId: 'user-1', allowedOrgIds: ORG, replacement: { title: 'V3' } })).status).toBe('already_terminal')
    // Exactement 2 lignes : l'ancienne (obsolete) + l'unique remplaçante.
    expect(store.captured_knowledge).toHaveLength(2)
    expect(store.captured_knowledge.filter((x) => x.status === 'active')).toHaveLength(1)
  })
})

describe('idempotence & sécurité', () => {
  it('une promesse déjà terminale → already_terminal, aucune réécriture', async () => {
    seedCaptured('resolved')
    const before = { ...row('captured_knowledge', 'cap-1') }
    const r = await fulfillPromise({ subject: capturedSubject, userId: 'user-2', allowedOrgIds: ORG })
    expect(r).toEqual({ status: 'already_terminal' })
    expect(row('captured_knowledge', 'cap-1')).toEqual(before) // rien n'a bougé
    expect(invalidated).toEqual([])
  })

  it('replace concurrent (ancienne déjà terminale) → already_terminal + remplaçante NON conservée', async () => {
    seedCaptured('resolved')
    const r = await replacePromise({ subject: capturedSubject, userId: 'user-1', allowedOrgIds: ORG, replacement: { title: 'Trop tard' } })
    expect(r.status).toBe('already_terminal')
    // Compensation : aucune promesse active fabriquée.
    expect(store.captured_knowledge.filter((x) => x.status === 'active')).toHaveLength(0)
    // Point 4 : la compensation supprime UNIQUEMENT la remplaçante ; la ligne
    // préexistante est intacte (jamais supprimée), et reste seule en base.
    expect(store.captured_knowledge).toHaveLength(1)
    expect(row('captured_knowledge', 'cap-1').status).toBe('resolved')
  })

  it('garde org fail-closed : sujet hors des organisations autorisées → not_found, aucune mutation', async () => {
    seedCaptured()
    const r = await fulfillPromise({ subject: capturedSubject, userId: 'user-1', allowedOrgIds: ['autre-org'] })
    expect(r).toEqual({ status: 'not_found' })
    expect(row('captured_knowledge', 'cap-1').status).toBe('active')
  })

  it('sujet introuvable → not_found', async () => {
    const r = await cancelPromise({ subject: capturedSubject, userId: 'user-1', allowedOrgIds: ORG })
    expect(r).toEqual({ status: 'not_found' })
  })
})

describe('createPromiseFollowUp — geste DISTINCT : la promesse n’est pas résolue', () => {
  it('crée une action et laisse la promesse ACTIVE', async () => {
    seedCaptured()
    const r = await createPromiseFollowUp({ subject: capturedSubject, userId: 'user-1', allowedOrgIds: ORG, title: 'Relancer le BET' })
    expect(r).toMatchObject({ status: 'created', actionId: 'action-1', siteId: 'site-1' })
    expect(createdActions[0]).toMatchObject({ site_id: 'site-1', title: 'Relancer le BET', created_from: 'promise_follow_up' })
    // La promesse reste active : le suivi n'est pas une résolution.
    expect(row('captured_knowledge', 'cap-1').status).toBe('active')
  })
})
