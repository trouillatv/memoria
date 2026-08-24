// SENTINELLES DU BRANCHEMENT LIVE DU RESOLVER CBO (P1-C2B.2, GO Vincent 2026-08-24).
//
// Ces cas couvrent la liste obligatoire avant tout commit :
//   1. idempotence (contrainte UNIQUE membre)
//   2. décision SAME_OBJECT → rattachement au CBO existant
//   3. décision RELATED_BUT_DISTINCT → nouvel objet, jamais de fusion
//   4. décision UNCERTAIN → nouvel objet, jamais de fusion
//   5. panne resolver (LLM/réseau) → non-bloquant, jamais de throw
//   6. isolation stricte entre sujets canoniques distincts
//   7. sentinelle réelle : "Terrassement et purge plateforme" — le cluster
//      photos G3 et le cluster Avis-G3 restent deux identités séparées
//      même sous le même (sujet, type).
//
// getCanonicalSubjectEntities() n'est PAS mocké : on veut prouver que le
// scoping par canonical_subject_id (déjà couvert par ailleurs) se comporte
// correctement une fois composé avec le resolver. Seul
// resolveCanonicalBusinessObjectGroups() (l'appel Gemini) est mocké — jamais
// d'appel réseau réel dans un test committé.

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let TABLES: Tables = {}
let idSeq = 0
const nextId = (prefix: string) => `${prefix}-gen-${++idSeq}`

const UNIQUE_CONSTRAINTS: Record<string, string[][]> = {
  canonical_business_object_member: [['member_entity_type', 'member_entity_id']],
}

// ── Faux client admin — select/insert/update/eq/in/is/not/maybeSingle/single/then ──
function makeAdmin(tables: Tables) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let mode: 'select' | 'update' | 'insert' = 'select'
    let payload: Row = {}
    let insertRows: Row[] = []

    const runSelect = () => {
      const rows = tables[table] ?? []
      return rows.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }))
    }

    const applyUpdate = () => {
      const rows = tables[table] ?? []
      const matched = rows.filter((r) => filters.every((f) => f(r)))
      matched.forEach((r) => Object.assign(r, payload))
      return matched.map((r) => ({ ...r }))
    }

    const doInsert = () => {
      tables[table] = tables[table] ?? []
      const results: Row[] = []
      let error: { code: string; message: string } | null = null
      for (const row of insertRows) {
        const constraints = UNIQUE_CONSTRAINTS[table] ?? []
        const conflict = constraints.some((cols) =>
          tables[table].some((existing) => cols.every((c) => existing[c] === row[c])),
        )
        if (conflict) {
          error = { code: '23505', message: 'duplicate key value violates unique constraint' }
          continue
        }
        const withId = { id: row.id ?? nextId(table), ...row }
        tables[table].push(withId)
        results.push(withId)
      }
      return { results, error }
    }

    const api = {
      select: (_cols?: string) => {
        if (mode !== 'insert') mode = 'select'
        return api
      },
      update: (p: Row) => ((mode = 'update'), (payload = p), api),
      insert: (p: Row | Row[]) => ((mode = 'insert'), (insertRows = Array.isArray(p) ? p : [p]), api),
      eq: (f: string, v: unknown) => (filters.push((r) => r[f] === v), api),
      in: (f: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[f])), api),
      is: (f: string, v: null) => (filters.push((r) => (r[f] ?? null) === v), api),
      not: (_f: string, _op: string, _v: unknown) => api,
      maybeSingle: () => {
        if (mode === 'insert') {
          const { results, error } = doInsert()
          return Promise.resolve({ data: results[0] ?? null, error })
        }
        const rows = mode === 'update' ? applyUpdate() : runSelect()
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
      single: () => {
        if (mode === 'insert') {
          const { results, error } = doInsert()
          return Promise.resolve({ data: results[0] ?? null, error })
        }
        const rows = mode === 'update' ? applyUpdate() : runSelect()
        return Promise.resolve({ data: rows[0] ?? null, error: rows[0] ? null : { code: 'PGRST116', message: 'no rows' } })
      },
      then: (resolve: (x: { data: Row[] | null; error: unknown }) => void) => {
        if (mode === 'insert') {
          const { results, error } = doInsert()
          return resolve({ data: error ? null : results, error })
        }
        if (mode === 'update') return resolve({ data: applyUpdate(), error: null })
        return resolve({ data: runSelect(), error: null })
      },
    }
    return api
  }
  return { from: (t: string) => builder(t) }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeAdmin(TABLES) as never,
}))

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }))
vi.mock('@/lib/db/canonical-business-object-resolve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/canonical-business-object-resolve')>()
  return {
    ...actual,
    resolveCanonicalBusinessObjectGroups: (...args: Parameters<typeof actual.resolveCanonicalBusinessObjectGroups>) =>
      mockResolve(...args),
  }
})

import {
  attachToCanonicalBusinessObject,
  attachHistoricalEntityToCanonicalBusinessObject,
  attachHistoricalReportEntitiesToCanonicalBusinessObjects,
} from '@/lib/db/canonical-business-object-attach'

const SITE = 'site-petro'
const CS1 = 'cs-terrassement-purge'
const CS2 = 'cs-autre-sujet'

function membersOf(cboId: string) {
  return (TABLES.canonical_business_object_member ?? []).filter((m) => m.canonical_business_object_id === cboId)
}
function memberRowsFor(entityId: string) {
  return (TABLES.canonical_business_object_member ?? []).filter((m) => m.member_entity_id === entityId)
}

beforeEach(() => {
  idSeq = 0
  mockResolve.mockReset()
  TABLES = {
    site_reserve: [],
    site_actions: [],
    site_deadlines: [],
    canonical_business_object: [],
    canonical_business_object_member: [],
    document_proposal_materialization: [],
    document_extraction_proposal: [],
    subject_thread_identity: [],
    // createSoloCbo/createGroupCbo résolvent le winner (makeWinnerResolver) avant
    // toute écriture (P1-C2B.3 Gate 2) — CS1/CS2 doivent exister et être 'active'
    // pour que les tests existants (aucun n'exerce une fusion) créent bien un CBO.
    canonical_subject: [
      { id: CS1, status: 'active', merged_into: null },
      { id: CS2, status: 'active', merged_into: null },
    ],
  }
})

describe('attachToCanonicalBusinessObject', () => {
  it('moins de 2 candidats → CBO solo déterministe, jamais d’appel au resolver', async () => {
    TABLES.site_reserve.push({ id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: CS1 })

    const outcome = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS1, entityType: 'site_reserve', entityId: 'r1', label: 'Fissure mur nord', date: null,
    })

    expect(outcome.kind).toBe('created_new')
    if (outcome.kind === 'created_new') expect(outcome.source).toBe('deterministic')
    expect(mockResolve).not.toHaveBeenCalled()
    expect(memberRowsFor('r1')).toHaveLength(1)
  })

  it('idempotence : rejouer sur la même entité renvoie already_member sans dupliquer', async () => {
    TABLES.site_reserve.push({ id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: CS1 })
    const first = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS1, entityType: 'site_reserve', entityId: 'r1', label: 'Fissure mur nord', date: null,
    })
    expect(first.kind).toBe('created_new')

    const second = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS1, entityType: 'site_reserve', entityId: 'r1', label: 'Fissure mur nord', date: null,
    })
    expect(second).toEqual({ kind: 'skipped', reason: 'already_member' })
    expect(memberRowsFor('r1')).toHaveLength(1)
  })

  it('SAME_OBJECT rattache au CBO existant du sibling', async () => {
    TABLES.canonical_business_object.push({ id: 'cbo-existing', site_id: SITE, object_type: 'site_reserve', label: 'Fissure mur nord', canonical_subject_id: CS1 })
    TABLES.canonical_business_object_member.push({ canonical_business_object_id: 'cbo-existing', member_entity_type: 'site_reserve', member_entity_id: 'r1' })
    TABLES.site_reserve.push(
      { id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: CS1 },
      { id: 'r2', label: 'Fissure toujours visible mur nord', issued_on: null, canonical_subject_id: CS1 },
    )
    mockResolve.mockResolvedValue([
      { label: 'Fissure mur nord', members: ['r1', 'r2'], decision: 'SAME_OBJECT', confidence: 0.95, reasoning: 'même non-conformité reformulée' },
    ])

    const outcome = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS1, entityType: 'site_reserve', entityId: 'r2', label: 'Fissure toujours visible mur nord', date: null,
    })

    expect(outcome).toMatchObject({ kind: 'attached_existing', canonicalBusinessObjectId: 'cbo-existing' })
    expect(membersOf('cbo-existing').map((m) => m.member_entity_id).sort()).toEqual(['r1', 'r2'])
  })

  it('RELATED_BUT_DISTINCT crée un nouvel objet, ne fusionne jamais', async () => {
    TABLES.canonical_business_object.push({ id: 'cbo-existing', site_id: SITE, object_type: 'site_reserve', label: 'Fissure mur nord', canonical_subject_id: CS1 })
    TABLES.canonical_business_object_member.push({ canonical_business_object_id: 'cbo-existing', member_entity_type: 'site_reserve', member_entity_id: 'r1' })
    TABLES.site_reserve.push(
      { id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: CS1 },
      { id: 'r2', label: 'Peinture écaillée mur sud', issued_on: null, canonical_subject_id: CS1 },
    )
    mockResolve.mockResolvedValue([
      { label: 'Peinture écaillée mur sud', members: ['r1', 'r2'], decision: 'RELATED_BUT_DISTINCT', confidence: 0.6, reasoning: 'même mur, non-conformité différente' },
    ])

    const outcome = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS1, entityType: 'site_reserve', entityId: 'r2', label: 'Peinture écaillée mur sud', date: null,
    })

    expect(outcome.kind).toBe('created_new')
    if (outcome.kind === 'created_new') {
      expect(outcome.canonicalBusinessObjectId).not.toBe('cbo-existing')
      expect(outcome.decision).toBe('RELATED_BUT_DISTINCT')
    }
    expect(membersOf('cbo-existing').map((m) => m.member_entity_id)).toEqual(['r1'])
  })

  it('UNCERTAIN crée un nouvel objet, ne fusionne jamais', async () => {
    TABLES.canonical_business_object.push({ id: 'cbo-existing', site_id: SITE, object_type: 'site_reserve', label: 'Fissure mur nord', canonical_subject_id: CS1 })
    TABLES.canonical_business_object_member.push({ canonical_business_object_id: 'cbo-existing', member_entity_type: 'site_reserve', member_entity_id: 'r1' })
    TABLES.site_reserve.push(
      { id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: CS1 },
      { id: 'r2', label: 'Problème mur nord (à préciser)', issued_on: null, canonical_subject_id: CS1 },
    )
    mockResolve.mockResolvedValue([
      { label: 'Problème mur nord', members: ['r1', 'r2'], decision: 'UNCERTAIN', confidence: 0.4, reasoning: 'doute réel' },
    ])

    const outcome = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS1, entityType: 'site_reserve', entityId: 'r2', label: 'Problème mur nord (à préciser)', date: null,
    })

    expect(outcome.kind).toBe('created_new')
    if (outcome.kind === 'created_new') expect(outcome.canonicalBusinessObjectId).not.toBe('cbo-existing')
  })

  it('panne du resolver (LLM/réseau) : non-bloquant, jamais de throw', async () => {
    TABLES.site_reserve.push(
      { id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: CS1 },
      { id: 'r2', label: 'Fissure encore visible', issued_on: null, canonical_subject_id: CS1 },
    )
    mockResolve.mockRejectedValue(new Error('Gemini indisponible'))

    const outcome = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS1, entityType: 'site_reserve', entityId: 'r2', label: 'Fissure encore visible', date: null,
    })

    expect(outcome).toEqual({ kind: 'skipped', reason: 'exception' })
  })

  it('isolation stricte entre sujets canoniques distincts', async () => {
    TABLES.site_reserve.push(
      { id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: CS1 },
      { id: 'r2', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: CS2 },
      { id: 'r3', label: 'Fissure mur nord (suite)', issued_on: null, canonical_subject_id: CS1 },
    )
    mockResolve.mockImplementation((entities: Array<{ entityId: string }>) => {
      expect(entities.map((e) => e.entityId).sort()).toEqual(['r1', 'r3'])
      return Promise.resolve([
        { label: 'Fissure mur nord', members: ['r1', 'r3'], decision: 'SAME_OBJECT', confidence: 0.9, reasoning: 'même non-conformité' },
      ])
    })

    const outcome = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS1, entityType: 'site_reserve', entityId: 'r3', label: 'Fissure mur nord (suite)', date: null,
    })

    expect(mockResolve).toHaveBeenCalledTimes(1)
    expect(outcome.kind).toBe('created_new')
    // r2 (autre sujet) ne doit avoir reçu aucun membership.
    expect(memberRowsFor('r2')).toHaveLength(0)
  })

  it('groupe SAME_OBJECT ambigu touchant deux CBO existants distincts → solo fallback, jamais de fusion de CBO', async () => {
    TABLES.canonical_business_object.push(
      { id: 'cbo-a', site_id: SITE, object_type: 'site_reserve', label: 'Cluster A', canonical_subject_id: CS1 },
      { id: 'cbo-b', site_id: SITE, object_type: 'site_reserve', label: 'Cluster B', canonical_subject_id: CS1 },
    )
    TABLES.canonical_business_object_member.push(
      { canonical_business_object_id: 'cbo-a', member_entity_type: 'site_reserve', member_entity_id: 'r1' },
      { canonical_business_object_id: 'cbo-b', member_entity_type: 'site_reserve', member_entity_id: 'r2' },
    )
    TABLES.site_reserve.push(
      { id: 'r1', label: 'A', issued_on: null, canonical_subject_id: CS1 },
      { id: 'r2', label: 'B', issued_on: null, canonical_subject_id: CS1 },
      { id: 'r3', label: 'C', issued_on: null, canonical_subject_id: CS1 },
    )
    mockResolve.mockResolvedValue([
      { label: 'A/B/C', members: ['r1', 'r2', 'r3'], decision: 'SAME_OBJECT', confidence: 0.7, reasoning: 'regroupement ambigu' },
    ])

    const outcome = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS1, entityType: 'site_reserve', entityId: 'r3', label: 'C', date: null,
    })

    expect(outcome.kind).toBe('created_new')
    if (outcome.kind === 'created_new') {
      expect(outcome.canonicalBusinessObjectId).not.toBe('cbo-a')
      expect(outcome.canonicalBusinessObjectId).not.toBe('cbo-b')
    }
    expect(membersOf('cbo-a').map((m) => m.member_entity_id)).toEqual(['r1'])
    expect(membersOf('cbo-b').map((m) => m.member_entity_id)).toEqual(['r2'])
  })

  it('sentinelle "Terrassement et purge plateforme" : cluster photos G3 et cluster Avis-G3 restent séparés', async () => {
    TABLES.canonical_business_object.push({ id: 'cbo-g3-photos', site_id: SITE, object_type: 'site_reserve', label: 'Terrassement et purge plateforme — photos G3', canonical_subject_id: CS1 })
    TABLES.canonical_business_object_member.push({ canonical_business_object_id: 'cbo-g3-photos', member_entity_type: 'site_reserve', member_entity_id: 'g3-1' })
    TABLES.site_reserve.push(
      { id: 'g3-1', label: 'Terrassement et purge plateforme — photos G3', issued_on: null, canonical_subject_id: CS1 },
      { id: 'g3-2', label: 'Terrassement et purge plateforme — photos G3 (suite)', issued_on: null, canonical_subject_id: CS1 },
      { id: 'avis-1', label: 'Avis G3 sur la purge de plateforme', issued_on: null, canonical_subject_id: CS1 },
    )
    mockResolve.mockImplementation((entities: Array<{ entityId: string; label: string }>) => {
      const g3 = entities.filter((e) => !e.label.startsWith('Avis'))
      const avis = entities.filter((e) => e.label.startsWith('Avis'))
      const groups: Array<{ label: string; members: string[]; decision: 'SAME_OBJECT' | 'RELATED_BUT_DISTINCT'; confidence: number; reasoning: string }> = []
      if (g3.length) groups.push({ label: 'Terrassement et purge plateforme — photos G3', members: g3.map((e) => e.entityId), decision: 'SAME_OBJECT', confidence: 0.9, reasoning: 'même non-conformité, photos successives' })
      if (avis.length) groups.push({ label: 'Avis G3 sur la purge de plateforme', members: avis.map((e) => e.entityId), decision: g3.length ? 'RELATED_BUT_DISTINCT' : 'SAME_OBJECT', confidence: 0.8, reasoning: 'avis distinct de la non-conformité photographiée' })
      return Promise.resolve(groups)
    })

    const g3Outcome = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS1, entityType: 'site_reserve', entityId: 'g3-2', label: 'Terrassement et purge plateforme — photos G3 (suite)', date: null,
    })
    const avisOutcome = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS1, entityType: 'site_reserve', entityId: 'avis-1', label: 'Avis G3 sur la purge de plateforme', date: null,
    })

    expect(g3Outcome).toMatchObject({ kind: 'attached_existing', canonicalBusinessObjectId: 'cbo-g3-photos' })
    expect(avisOutcome.kind).toBe('created_new')
    if (avisOutcome.kind === 'created_new') expect(avisOutcome.canonicalBusinessObjectId).not.toBe('cbo-g3-photos')

    expect(membersOf('cbo-g3-photos').map((m) => m.member_entity_id).sort()).toEqual(['g3-1', 'g3-2'])
    if (avisOutcome.kind === 'created_new') {
      expect(membersOf(avisOutcome.canonicalBusinessObjectId).map((m) => m.member_entity_id)).toEqual(['avis-1'])
    }
  })
})

describe('attachHistoricalEntityToCanonicalBusinessObject', () => {
  it('résout via la chaîne document_proposal_materialization → proposal → subject_thread_identity, pose la colonne et rattache', async () => {
    TABLES.site_reserve.push({ id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: null })
    TABLES.document_proposal_materialization.push({ proposal_id: 'prop-1', target_entity_type: 'site_reserve', target_entity_id: 'r1' })
    TABLES.document_extraction_proposal.push({ id: 'prop-1', subject_thread_id: 'th-1' })
    TABLES.subject_thread_identity.push({ subject_thread_id: 'th-1', canonical_subject_id: CS1 })

    await attachHistoricalEntityToCanonicalBusinessObject({ siteId: SITE, entityType: 'site_reserve', entityId: 'r1', label: 'Fissure mur nord', date: null })

    expect(TABLES.site_reserve.find((r) => r.id === 'r1')?.canonical_subject_id).toBe(CS1)
    expect(memberRowsFor('r1')).toHaveLength(1)
  })

  it('aucune preuve structurelle (pas de matérialisation) → ne fait rien, jamais de throw', async () => {
    TABLES.site_reserve.push({ id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: null })

    await expect(
      attachHistoricalEntityToCanonicalBusinessObject({ siteId: SITE, entityType: 'site_reserve', entityId: 'r1', label: 'Fissure mur nord', date: null }),
    ).resolves.toBeUndefined()

    expect(TABLES.site_reserve.find((r) => r.id === 'r1')?.canonical_subject_id).toBeNull()
    expect(memberRowsFor('r1')).toHaveLength(0)
  })
})

describe('attachHistoricalReportEntitiesToCanonicalBusinessObjects', () => {
  it('rattache actions/échéances déjà résolues et réserves via la chaîne historique, jamais de throw sur un rapport vide', async () => {
    await expect(
      attachHistoricalReportEntitiesToCanonicalBusinessObjects({ siteId: SITE, siteReportId: 'report-empty' }),
    ).resolves.toBeUndefined()
  })

  it('orchestre les 3 types pour un même rapport', async () => {
    const REPORT = 'report-1'
    TABLES.site_actions.push({ id: 'a1', title: 'Reprendre étanchéité', due_date: null, canonical_subject_id: CS1, report_id: REPORT })
    TABLES.site_deadlines.push({ id: 'd1', title: 'Livraison lot enrobage', due_date: '2026-09-01', canonical_subject_id: null, report_id: REPORT })
    TABLES.site_reserve.push({ id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: null, report_id: REPORT })
    TABLES.document_proposal_materialization.push({ proposal_id: 'prop-r1', target_entity_type: 'site_reserve', target_entity_id: 'r1' })
    TABLES.document_extraction_proposal.push({ id: 'prop-r1', subject_thread_id: 'th-r1' })
    TABLES.subject_thread_identity.push({ subject_thread_id: 'th-r1', canonical_subject_id: CS2 })

    await attachHistoricalReportEntitiesToCanonicalBusinessObjects({ siteId: SITE, siteReportId: REPORT })

    // action : canonical_subject_id déjà posé (par projectCanonicalSubjectOnObjects en amont) → rattachée directement.
    expect(memberRowsFor('a1')).toHaveLength(1)
    // échéance : canonical_subject_id encore null (aucune preuve structurelle en amont) → jamais rattachée ici, pas de re-résolution par libellé.
    expect(memberRowsFor('d1')).toHaveLength(0)
    // réserve : résolue via la chaîne historique (seul chemin pour ce type).
    expect(TABLES.site_reserve.find((r) => r.id === 'r1')?.canonical_subject_id).toBe(CS2)
    expect(memberRowsFor('r1')).toHaveLength(1)
  })
})

// SENTINELLES P1-C2B.3 GATE 2 : résolution du winner (makeWinnerResolver) juste
// avant la création d'un CBO — jamais de CBO écrit sur un sujet déjà fusionné
// (loser), même si canonicalSubjectId reçu par l'appelant en est un.
describe('résolution du winner à la création (createSoloCbo)', () => {
  it('canonicalSubjectId déjà fusionné (1 saut) au moment de la création → le CBO est écrit sur le winner, jamais sur le loser', async () => {
    const CS_LOSER = 'cs-loser-1hop'
    TABLES.canonical_subject.push({ id: CS_LOSER, status: 'merged', merged_into: CS1 })
    TABLES.site_reserve.push({ id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: CS_LOSER })

    const outcome = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS_LOSER, entityType: 'site_reserve', entityId: 'r1', label: 'Fissure mur nord', date: null,
    })

    expect(outcome.kind).toBe('created_new')
    if (outcome.kind === 'created_new') {
      const cbo = TABLES.canonical_business_object.find((c) => c.id === outcome.canonicalBusinessObjectId)
      expect(cbo?.canonical_subject_id).toBe(CS1)
    }
  })

  it('chaîne de fusion à 2 sauts (A→B→C) → le CBO est écrit sur le winner final C', async () => {
    const CS_A = 'cs-chain-a'
    const CS_B = 'cs-chain-b'
    TABLES.canonical_subject.push(
      { id: CS_A, status: 'merged', merged_into: CS_B },
      { id: CS_B, status: 'merged', merged_into: CS1 },
    )
    TABLES.site_reserve.push({ id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: CS_A })

    const outcome = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS_A, entityType: 'site_reserve', entityId: 'r1', label: 'Fissure mur nord', date: null,
    })

    expect(outcome.kind).toBe('created_new')
    if (outcome.kind === 'created_new') {
      const cbo = TABLES.canonical_business_object.find((c) => c.id === outcome.canonicalBusinessObjectId)
      expect(cbo?.canonical_subject_id).toBe(CS1)
    }
  })

  it('chaîne cyclique (irrésolvable) → aucun CBO créé, skip winner_unresolved', async () => {
    const CS_X = 'cs-cycle-x'
    const CS_Y = 'cs-cycle-y'
    TABLES.canonical_subject.push(
      { id: CS_X, status: 'merged', merged_into: CS_Y },
      { id: CS_Y, status: 'merged', merged_into: CS_X },
    )
    TABLES.site_reserve.push({ id: 'r1', label: 'Fissure mur nord', issued_on: null, canonical_subject_id: CS_X })

    const outcome = await attachToCanonicalBusinessObject({
      siteId: SITE, canonicalSubjectId: CS_X, entityType: 'site_reserve', entityId: 'r1', label: 'Fissure mur nord', date: null,
    })

    expect(outcome).toEqual({ kind: 'skipped', reason: 'winner_unresolved' })
    expect(TABLES.canonical_business_object).toHaveLength(0)
    expect(memberRowsFor('r1')).toHaveLength(0)
  })
})
