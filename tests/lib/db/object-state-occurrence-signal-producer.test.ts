// Test UNITAIRE (Supabase mocké en mémoire, aucun appel réseau) — P1-C2B.4 H2-B.2.
//
// Couvre la logique PROPRE du producteur (routage fast-path/LLM, upsert idempotent,
// retry sur unresolved, texte transmis = celui de l'entité elle-même) — indépendamment
// de la correction interne de classifyOccurrenceStateSignal (déjà couverte par
// tests/lib/ai/classify-occurrence-state-signal.test.ts). Même pattern de mock que
// tests/lib/db/canonical-business-object-attach.test.ts (faux client admin en mémoire,
// seul l'appel LLM externe est mocké).
//
// La preuve d'intégration DB réelle (contrainte UNIQUE, resolved_xor_unresolved) vit
// dans tests/lib/db/object-state-occurrence-signal-constraints.test.ts (H2-B.1) et
// tests/lib/db/object-state-occurrence-signal-producer-integration.test.ts (H2-B.2).

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

let TABLES: Tables = {}
let idSeq = 0
const nextId = (prefix: string) => `${prefix}-gen-${++idSeq}`

function makeAdmin(tables: Tables) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let mode: 'select' | 'upsert' = 'select'
    let upsertRow: Row = {}
    let onConflictCols: string[] = []

    const runSelect = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }))

    const doUpsert = () => {
      tables[table] = tables[table] ?? []
      const existing = onConflictCols.length
        ? tables[table].find((r) => onConflictCols.every((c) => r[c] === upsertRow[c]))
        : undefined
      if (existing) {
        Object.assign(existing, upsertRow)
      } else {
        tables[table].push({ id: upsertRow.id ?? nextId(table), ...upsertRow })
      }
      return { error: null as unknown }
    }

    const api = {
      select: (_cols?: string) => api,
      upsert: (row: Row, opts?: { onConflict?: string }) => {
        mode = 'upsert'
        upsertRow = row
        onConflictCols = (opts?.onConflict ?? '').split(',').filter(Boolean)
        return api
      },
      eq: (f: string, v: unknown) => (filters.push((r) => r[f] === v), api),
      maybeSingle: () => {
        if (mode === 'upsert') return Promise.resolve(doUpsert())
        const rows = runSelect()
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
      then: (resolve: (x: { data: Row[] | null; error: unknown }) => void) => {
        if (mode === 'upsert') {
          const { error } = doUpsert()
          return resolve({ data: null, error })
        }
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

const { mockClassify } = vi.hoisted(() => ({ mockClassify: vi.fn() }))
vi.mock('@/lib/ai/classify-occurrence-state-signal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/classify-occurrence-state-signal')>()
  return { ...actual, classifyOccurrenceStateSignal: mockClassify }
})

import { produceObjectStateOccurrenceSignal, emitNativeActionLifecycleSignal } from '@/lib/db/object-state-occurrence-signal'

const SITE = 'site-1'

function signalRow(entityId: string) {
  return (TABLES.object_state_occurrence_signal ?? []).find((r) => r.entity_id === entityId)
}

beforeEach(() => {
  idSeq = 0
  mockClassify.mockReset()
  TABLES = {
    site_actions: [],
    site_reserve: [],
    site_deadlines: [],
    canonical_business_object_member: [],
    document_proposal_materialization: [],
    document_extraction_proposal: [],
    object_state_occurrence_signal: [],
  }
})

describe('produceObjectStateOccurrenceSignal — fast-path document_status (ÉTAPE 0)', () => {
  it.each([
    ['done', 'COMPLETED'],
    ['cancelled', 'NO_STATE_SIGNAL'], // P1-4A-D2 : cancelled ≠ accomplissement → jamais COMPLETED
    ['in_progress', 'PROGRESS'],
    ['non_compliant', 'STILL_OPEN'],
    ['awaiting_validation', 'STILL_OPEN'],
    ['planned', 'OPENED'],
    ['open', 'STILL_OPEN'],
    ['valeur_inconnue', 'NO_STATE_SIGNAL'],
  ])('document_status=%s → final_signal=%s, sans appel LLM', async (documentStatus, expected) => {
    const entityId = 'r1'
    TABLES.site_reserve.push({ id: entityId, site_id: SITE, label: 'Fissure mur nord', lift_note: null, issued_on: '2026-08-01' })
    TABLES.document_proposal_materialization.push({ proposal_id: 'prop-1', target_entity_type: 'site_reserve', target_entity_id: entityId })
    TABLES.document_extraction_proposal.push({ id: 'prop-1', document_status: documentStatus })

    const result = await produceObjectStateOccurrenceSignal({ entityType: 'site_reserve', entityId })

    expect(result).toEqual({ kind: 'resolved', source: 'document_status', finalSignal: expected })
    expect(mockClassify).not.toHaveBeenCalled()
    const row = signalRow(entityId)
    expect(row).toMatchObject({ status: 'resolved', source: 'document_status', final_signal: expected, step1_signal: null, error_code: null })
  })

  it('bascule sur le LLM si aucune matérialisation n’existe (occurrence terrain)', async () => {
    const entityId = 'r2'
    TABLES.site_reserve.push({ id: entityId, site_id: SITE, label: 'Non-conformité électrique', lift_note: null, issued_on: null })
    mockClassify.mockResolvedValue({ ok: true, signal: 'OPENED', confidence: 0.8, evidenceText: 'Non-conformité électrique' })

    const result = await produceObjectStateOccurrenceSignal({ entityType: 'site_reserve', entityId })

    expect(result).toEqual({ kind: 'resolved', source: 'llm', finalSignal: 'OPENED' })
    expect(mockClassify).toHaveBeenCalledTimes(1)
  })

  it('bascule sur le LLM si document_status est null malgré une matérialisation existante', async () => {
    const entityId = 'a1'
    TABLES.site_actions.push({ id: entityId, site_id: SITE, title: 'Poser garde-corps', body: null, due_date: null })
    TABLES.document_proposal_materialization.push({ proposal_id: 'prop-2', target_entity_type: 'site_action', target_entity_id: entityId })
    TABLES.document_extraction_proposal.push({ id: 'prop-2', document_status: null })
    mockClassify.mockResolvedValue({ ok: true, signal: 'NO_STATE_SIGNAL', confidence: 0.6, evidenceText: '' })

    await produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId })

    expect(mockClassify).toHaveBeenCalledTimes(1)
  })
})

describe('produceObjectStateOccurrenceSignal — texte transmis = celui de l’entité elle-même', () => {
  it('site_action : title + body, jamais un autre texte', async () => {
    const entityId = 'a2'
    TABLES.site_actions.push({ id: entityId, site_id: SITE, title: 'Reprise étanchéité toiture', body: 'Infiltration constatée niveau R+2.', due_date: '2026-09-01' })
    mockClassify.mockResolvedValue({ ok: true, signal: 'OPENED', confidence: 0.7, evidenceText: 'x' })

    await produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId })

    expect(mockClassify).toHaveBeenCalledWith('Reprise étanchéité toiture\nInfiltration constatée niveau R+2.')
  })

  it('site_reserve : label + lift_note', async () => {
    const entityId = 'r3'
    TABLES.site_reserve.push({ id: entityId, site_id: SITE, label: 'Fissure façade nord', lift_note: 'Reprise validée par le BC.', issued_on: '2026-07-01' })
    mockClassify.mockResolvedValue({ ok: true, signal: 'COMPLETED', confidence: 0.9, evidenceText: 'x' })

    await produceObjectStateOccurrenceSignal({ entityType: 'site_reserve', entityId })

    expect(mockClassify).toHaveBeenCalledWith('Fissure façade nord\nReprise validée par le BC.')
  })

  it('site_deadline : title + constraint_text', async () => {
    const entityId = 'd1'
    TABLES.site_deadlines.push({ id: entityId, site_id: SITE, title: 'Livraison coffret électrique', constraint_text: 'Avant la mise sous tension du bâtiment B.', due_date: '2026-10-01' })
    mockClassify.mockResolvedValue({ ok: true, signal: 'STILL_OPEN', confidence: 0.65, evidenceText: 'x' })

    await produceObjectStateOccurrenceSignal({ entityType: 'site_deadline', entityId })

    expect(mockClassify).toHaveBeenCalledWith('Livraison coffret électrique\nAvant la mise sous tension du bâtiment B.')
  })
})

describe('produceObjectStateOccurrenceSignal — LLM : succès en pass-through (step2/backstop hors périmètre H2-B.2)', () => {
  it('final_signal = step1_signal, source=llm, confiance persistée', async () => {
    const entityId = 'a3'
    TABLES.site_actions.push({ id: entityId, site_id: SITE, title: 'Purge réseau EU', body: null, due_date: null })
    mockClassify.mockResolvedValue({ ok: true, signal: 'PROGRESS', confidence: 0.77, evidenceText: 'Travaux engagés.' })

    const result = await produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId })

    expect(result).toEqual({ kind: 'resolved', source: 'llm', finalSignal: 'PROGRESS' })
    const row = signalRow(entityId)
    expect(row).toMatchObject({
      status: 'resolved', source: 'llm',
      step1_signal: 'PROGRESS', final_signal: 'PROGRESS',
      step2_signal: null, backstop_applied: false,
      confidence: 0.77, error_code: null, attempt_count: 1,
    })
  })
})

describe('produceObjectStateOccurrenceSignal — panne LLM : diagnostic typé, jamais NO_STATE_SIGNAL silencieux', () => {
  it('persiste unresolved avec error_code, final_signal reste null', async () => {
    const entityId = 'a4'
    TABLES.site_actions.push({ id: entityId, site_id: SITE, title: 'Contrôle SSI', body: null, due_date: null })
    mockClassify.mockResolvedValue({ ok: false, errorCode: 'TIMEOUT', errorDetail: 'Timeout après 20000ms' })

    const result = await produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId })

    expect(result).toEqual({ kind: 'unresolved', errorCode: 'TIMEOUT' })
    const row = signalRow(entityId)
    expect(row).toMatchObject({ status: 'unresolved', source: 'llm', final_signal: null, error_code: 'TIMEOUT', attempt_count: 1 })
  })
})

describe('produceObjectStateOccurrenceSignal — idempotence et retry', () => {
  it('une ligne déjà resolved n’est jamais recalculée', async () => {
    const entityId = 'a5'
    TABLES.site_actions.push({ id: entityId, site_id: SITE, title: 'Déjà traité', body: null, due_date: null })
    TABLES.object_state_occurrence_signal.push({
      id: 'sig-1', entity_type: 'site_action', entity_id: entityId, site_id: SITE,
      status: 'resolved', source: 'llm', final_signal: 'COMPLETED', attempt_count: 1,
    })

    const result = await produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId })

    expect(result).toEqual({ kind: 'skipped_already_resolved', finalSignal: 'COMPLETED' })
    expect(mockClassify).not.toHaveBeenCalled()
    expect(TABLES.object_state_occurrence_signal).toHaveLength(1)
  })

  it('une ligne unresolved est retentée, jamais dupliquée (UNIQUE entity_type,entity_id)', async () => {
    const entityId = 'a6'
    TABLES.site_actions.push({ id: entityId, site_id: SITE, title: 'Retenté après panne', body: null, due_date: null })
    TABLES.object_state_occurrence_signal.push({
      id: 'sig-2', entity_type: 'site_action', entity_id: entityId, site_id: SITE,
      status: 'unresolved', source: 'llm', final_signal: null, error_code: 'NETWORK_ERROR', attempt_count: 1,
    })
    mockClassify.mockResolvedValue({ ok: true, signal: 'OPENED', confidence: 0.5, evidenceText: 'x' })

    const result = await produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId })

    expect(result).toEqual({ kind: 'resolved', source: 'llm', finalSignal: 'OPENED' })
    expect(TABLES.object_state_occurrence_signal).toHaveLength(1)
    const row = signalRow(entityId)
    expect(row).toMatchObject({ status: 'resolved', final_signal: 'OPENED', attempt_count: 2, error_code: null })
  })
})

describe('produceObjectStateOccurrenceSignal — canonical_business_object_id', () => {
  it('reprend le CBO déjà rattaché au membership, si présent', async () => {
    const entityId = 'a7'
    TABLES.site_actions.push({ id: entityId, site_id: SITE, title: 'Action rattachée', body: null, due_date: null })
    TABLES.canonical_business_object_member.push({ member_entity_type: 'site_action', member_entity_id: entityId, canonical_business_object_id: 'cbo-1' })
    mockClassify.mockResolvedValue({ ok: true, signal: 'OPENED', confidence: 0.5, evidenceText: 'x' })

    await produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId })

    expect(signalRow(entityId)).toMatchObject({ canonical_business_object_id: 'cbo-1' })
  })

  it('reste null si l’entité n’est pas (encore) membre d’un CBO', async () => {
    const entityId = 'a8'
    TABLES.site_actions.push({ id: entityId, site_id: SITE, title: 'Action non rattachée', body: null, due_date: null })
    mockClassify.mockResolvedValue({ ok: true, signal: 'OPENED', confidence: 0.5, evidenceText: 'x' })

    await produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId })

    expect(signalRow(entityId)).toMatchObject({ canonical_business_object_id: null })
  })
})

describe('produceObjectStateOccurrenceSignal — entité introuvable', () => {
  it('lève une erreur explicite plutôt que d’écrire une ligne creuse', async () => {
    await expect(produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId: 'inconnu' }))
      .rejects.toThrow(/introuvable/)
    expect(TABLES.object_state_occurrence_signal).toHaveLength(0)
  })
})

// ── P1-4A — cycle de vie NATIF (emitNativeActionLifecycleSignal) ──────────────
// La réduction final_signal → état CBO (COMPLETED⇒DONE, REOPENED⇒REOPENED) appartient à
// canonical-business-object-evolution.ts (code existant) ; ici on prouve que l'événement natif
// produit EXACTEMENT le bon signal, sur la bonne occurrence, avec la bonne provenance.

describe('emitNativeActionLifecycleSignal — clôture/réouverture explicite = preuve de premier ordre', () => {
  function seedAction(entityId: string, cboId: string | null) {
    TABLES.site_actions.push({ id: entityId, site_id: SITE, title: 'Poser garde-corps', body: null, due_date: null })
    if (cboId) TABLES.canonical_business_object_member.push({ member_entity_type: 'site_action', member_entity_id: entityId, canonical_business_object_id: cboId })
  }

  it('completed → final_signal=COMPLETED, source=native_action_event, rattaché au CBO', async () => {
    seedAction('a-done', 'cbo-A')
    const out = await emitNativeActionLifecycleSignal({ entityType: 'site_action', entityId: 'a-done', event: 'completed' })
    expect(out).toMatchObject({ kind: 'emitted', finalSignal: 'COMPLETED', canonicalBusinessObjectId: 'cbo-A' })
    expect(signalRow('a-done')).toMatchObject({
      status: 'resolved', source: 'native_action_event', final_signal: 'COMPLETED',
      canonical_business_object_id: 'cbo-A', entity_type: 'site_action',
    })
  })

  it('reopened → final_signal=REOPENED', async () => {
    seedAction('a-reop', 'cbo-A')
    const out = await emitNativeActionLifecycleSignal({ entityType: 'site_action', entityId: 'a-reop', event: 'reopened' })
    expect(out).toMatchObject({ kind: 'emitted', finalSignal: 'REOPENED' })
    expect(signalRow('a-reop')).toMatchObject({ source: 'native_action_event', final_signal: 'REOPENED' })
  })

  it('action sans CBO → skip explicite, AUCUN rattachement forcé, aucune ligne de signal', async () => {
    seedAction('a-orphan', null)
    const out = await emitNativeActionLifecycleSignal({ entityType: 'site_action', entityId: 'a-orphan', event: 'completed' })
    expect(out).toEqual({ kind: 'skipped_no_cbo' })
    expect(signalRow('a-orphan')).toBeUndefined()
  })

  it('supersède le signal documentaire de la MÊME occurrence (une seule ligne, UNIQUE)', async () => {
    seedAction('a-super', 'cbo-A')
    TABLES.object_state_occurrence_signal.push({
      id: 'sig-doc', entity_type: 'site_action', entity_id: 'a-super', site_id: SITE,
      status: 'resolved', source: 'document_status', final_signal: 'OPENED', canonical_business_object_id: 'cbo-A',
    })
    await emitNativeActionLifecycleSignal({ entityType: 'site_action', entityId: 'a-super', event: 'completed' })
    const rows = (TABLES.object_state_occurrence_signal ?? []).filter((r) => r.entity_id === 'a-super')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'native_action_event', final_signal: 'COMPLETED' })
  })

  it('idempotence : deux clôtures successives → une seule ligne COMPLETED', async () => {
    seedAction('a-idem', 'cbo-A')
    await emitNativeActionLifecycleSignal({ entityType: 'site_action', entityId: 'a-idem', event: 'completed' })
    await emitNativeActionLifecycleSignal({ entityType: 'site_action', entityId: 'a-idem', event: 'completed' })
    const rows = (TABLES.object_state_occurrence_signal ?? []).filter((r) => r.entity_id === 'a-idem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ final_signal: 'COMPLETED' })
  })

  it('OPEN → COMPLETE → REOPEN : la ligne finit à REOPENED (≠ DONE)', async () => {
    seedAction('a-seq', 'cbo-A')
    await emitNativeActionLifecycleSignal({ entityType: 'site_action', entityId: 'a-seq', event: 'completed' })
    await emitNativeActionLifecycleSignal({ entityType: 'site_action', entityId: 'a-seq', event: 'reopened' })
    expect(signalRow('a-seq')).toMatchObject({ final_signal: 'REOPENED' })
  })

  it('terminer A ne touche jamais l’occurrence B du même CBO', async () => {
    seedAction('A', 'cbo-A')
    seedAction('B', 'cbo-A')
    await emitNativeActionLifecycleSignal({ entityType: 'site_action', entityId: 'A', event: 'completed' })
    expect(signalRow('A')).toMatchObject({ final_signal: 'COMPLETED' })
    expect(signalRow('B')).toBeUndefined() // B intacte
  })
})
