// Test d'INTÉGRATION (vraie Supabase, fetch mocké) — P1-C2B.4 H2-B.2.
//
// Complète tests/lib/db/object-state-occurrence-signal-producer.test.ts (logique du
// producteur, DB mockée en mémoire) en prouvant que produceObjectStateOccurrenceSignal
// persiste correctement contre la VRAIE table object_state_occurrence_signal (migration
// 349) — colonnes, contrainte UNIQUE(entity_type, entity_id), upsert idempotent, retry.
//
// Seul fetch (appel Gemini) est mocké — aucune vraie clé API consommée. La DB est réelle :
// seed minimal de site_actions/site_reserve (site_id + title/label suffisent, cf.
// lib/db/site-actions.ts et supabase/migrations/110_site_reserve.sql). Pas de
// document_extraction_proposal/document_proposal_materialization ici — ces tables ont un
// schéma trop évolutif pour un seed minimal fiable ; le fast-path document_status est déjà
// couvert exhaustivement par le test unitaire mocké.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { produceObjectStateOccurrenceSignal } from '@/lib/db/object-state-occurrence-signal'
import { randomUUID } from 'node:crypto'

const TAG = `__test_h2b2_producer_integration_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string

// createAdminClient() (supabase-js) utilise fetch en interne pour parler à la vraie base —
// stubber globalThis.fetch sans discrimination casserait TOUTES les requêtes DB, pas
// seulement l'appel Gemini. On intercepte uniquement les requêtes vers l'API Gemini et on
// laisse passer le reste vers le vrai fetch (capturé avant tout stub).
const realFetch = globalThis.fetch

function stubGeminiFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const urlStr = String(url)
    if (urlStr.includes('generativelanguage.googleapis.com')) return handler(urlStr, init)
    return realFetch(url as never, init)
  }))
}

function geminiTextResponse(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 })
}

beforeAll(async () => {
  const db = createAdminClient()

  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  const { data: client, error: cErr } = await db
    .from('clients')
    .insert({ name: `${TAG}client`, organization_id: orgId })
    .select('id').single()
  if (cErr) throw cErr
  clientId = (client as { id: string }).id

  const { data: site, error: sErr } = await db
    .from('sites')
    .insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId })
    .select('id').single()
  if (sErr) throw sErr
  siteId = (site as { id: string }).id
})

afterAll(async () => {
  const db = createAdminClient()
  await db.from('object_state_occurrence_signal').delete().eq('site_id', siteId)
  await db.from('site_actions').delete().eq('site_id', siteId)
  await db.from('site_reserve').delete().eq('site_id', siteId)
  if (siteId) await db.from('sites').delete().eq('id', siteId)
  if (clientId) await db.from('clients').delete().eq('id', clientId)
})

beforeEach(() => {
  vi.stubEnv('GOOGLE_GENAI_API_KEY', 'gk-test-integration')
  vi.stubEnv('AI_MODEL_LIGHT', 'gemini-2.5-flash')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('produceObjectStateOccurrenceSignal — persistance réelle (chemin LLM)', () => {
  it('persiste une ligne resolved avec les champs LLM corrects', async () => {
    const db = createAdminClient()
    const { data: action, error } = await db
      .from('site_actions')
      .insert({ site_id: siteId, title: 'Reprise étanchéité toiture', body: 'Infiltration constatée niveau R+2.' })
      .select('id').single()
    if (error) throw error
    const entityId = (action as { id: string }).id

    stubGeminiFetch(() =>
      geminiTextResponse(JSON.stringify({ signal: 'PROGRESS', confidence: 0.81, evidence_text: 'Infiltration constatée.' })),
    )

    const result = await produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId })
    expect(result).toEqual({ kind: 'resolved', source: 'llm', finalSignal: 'PROGRESS' })

    const { data: row } = await db
      .from('object_state_occurrence_signal')
      .select('*')
      .eq('entity_type', 'site_action').eq('entity_id', entityId)
      .single()
    expect(row).toMatchObject({
      site_id: siteId,
      status: 'resolved',
      source: 'llm',
      step1_signal: 'PROGRESS',
      final_signal: 'PROGRESS',
      step2_signal: null,
      backstop_applied: false,
      confidence: 0.81,
      error_code: null,
      attempt_count: 1,
    })
  })

  it('persiste une ligne unresolved diagnostiquée sur panne LLM, puis la retente au lieu de dupliquer', async () => {
    const db = createAdminClient()
    const { data: reserve, error } = await db
      .from('site_reserve')
      .insert({ site_id: siteId, label: 'Fissure mur nord' })
      .select('id').single()
    if (error) throw error
    const entityId = (reserve as { id: string }).id

    stubGeminiFetch(() => new Response('boom', { status: 500 }))
    const first = await produceObjectStateOccurrenceSignal({ entityType: 'site_reserve', entityId })
    expect(first).toEqual({ kind: 'unresolved', errorCode: 'PROVIDER_ERROR' })

    const { data: rowAfterFailure } = await db
      .from('object_state_occurrence_signal')
      .select('id, status, error_code, attempt_count, final_signal')
      .eq('entity_type', 'site_reserve').eq('entity_id', entityId)
      .single()
    expect(rowAfterFailure).toMatchObject({ status: 'unresolved', error_code: 'PROVIDER_ERROR', attempt_count: 1, final_signal: null })

    stubGeminiFetch(() =>
      geminiTextResponse(JSON.stringify({ signal: 'COMPLETED', confidence: 0.95, evidence_text: 'Reprise validée.' })),
    )
    const retry = await produceObjectStateOccurrenceSignal({ entityType: 'site_reserve', entityId })
    expect(retry).toEqual({ kind: 'resolved', source: 'llm', finalSignal: 'COMPLETED' })

    const { data: rowsAfterRetry } = await db
      .from('object_state_occurrence_signal')
      .select('id, status, final_signal, attempt_count, error_code')
      .eq('entity_type', 'site_reserve').eq('entity_id', entityId)
    expect(rowsAfterRetry).toHaveLength(1)
    expect(rowsAfterRetry?.[0]).toMatchObject({
      id: rowAfterFailure?.id,
      status: 'resolved',
      final_signal: 'COMPLETED',
      attempt_count: 2,
      error_code: null,
    })
  })

  it('idempotence : une ligne déjà resolved n’est jamais recalculée', async () => {
    const db = createAdminClient()
    const { data: action, error } = await db
      .from('site_actions')
      .insert({ site_id: siteId, title: 'Contrôle SSI' })
      .select('id').single()
    if (error) throw error
    const entityId = (action as { id: string }).id

    stubGeminiFetch(() =>
      geminiTextResponse(JSON.stringify({ signal: 'COMPLETED', confidence: 0.9, evidence_text: 'Fait.' })),
    )
    await produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId })

    let geminiCallCount = 0
    stubGeminiFetch(() => {
      geminiCallCount += 1
      return geminiTextResponse(JSON.stringify({ signal: 'OPENED', confidence: 0.5, evidence_text: 'x' }))
    })
    const second = await produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId })

    expect(second).toEqual({ kind: 'skipped_already_resolved', finalSignal: 'COMPLETED' })
    expect(geminiCallCount).toBe(0)

    const { data: rows } = await db
      .from('object_state_occurrence_signal')
      .select('id')
      .eq('entity_type', 'site_action').eq('entity_id', entityId)
    expect(rows).toHaveLength(1)
  })

  it('entité introuvable : lève une erreur explicite, aucune ligne écrite', async () => {
    const db = createAdminClient()
    const entityId = randomUUID()

    await expect(produceObjectStateOccurrenceSignal({ entityType: 'site_action', entityId })).rejects.toThrow(/introuvable/)

    const { data: rows } = await db
      .from('object_state_occurrence_signal')
      .select('id')
      .eq('entity_type', 'site_action').eq('entity_id', entityId)
    expect(rows).toHaveLength(0)
  })
})
