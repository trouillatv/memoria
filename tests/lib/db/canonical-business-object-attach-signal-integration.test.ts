// Test d'INTÉGRATION (vraie Supabase, fetch Gemini mocké) — P1-C2B H2-B.3.
//
// Prouve le branchement live de produceObjectStateOccurrenceSignal (cb67eedb) DEPUIS
// lib/db/canonical-business-object-attach.ts (produceSignalBestEffort) : les 4 chemins
// réels (createSiteAction/createSiteReserve/createSiteDeadline/import PV historique)
// partagent tous soit resolveSubjectAndAttachCanonicalBusinessObject soit
// attachHistoricalReportEntitiesToCanonicalBusinessObjects — ce test appelle ces
// orchestrateurs directement (même chemin que les writers de production, sans le
// fire-and-forget `void` qui rendrait le test non déterministe).
//
// Deux appels Gemini distincts partagent la même URL/modèle (resolveCanonicalBusinessObjectGroups
// et classifyOccurrenceStateSignal) — on discrimine par le contenu du corps de requête :
// le schéma du resolver CBO contient "groups", celui du classificateur de signal contient
// "evidence_text" (cf. lib/db/canonical-business-object-resolve.ts et
// lib/ai/classify-occurrence-state-signal.ts).

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  resolveSubjectAndAttachCanonicalBusinessObject,
  attachHistoricalReportEntitiesToCanonicalBusinessObjects,
} from '@/lib/db/canonical-business-object-attach'

const TAG = `__test_h2b3_signal_wiring_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let siteReportId: string

// Même piège que object-state-occurrence-signal-producer-integration.test.ts : supabase-js
// utilise fetch en interne, donc on n'intercepte QUE les requêtes vers l'API Gemini.
const realFetch = globalThis.fetch

type GeminiEntity = { entityId: string; label: string; date: string | null; stableKey: string | null }

function parseGeminiEntities(init?: RequestInit): GeminiEntity[] {
  const body = JSON.parse(String(init?.body ?? '{}'))
  const text = body?.contents?.[0]?.parts?.[0]?.text ?? '[]'
  return JSON.parse(text)
}

function geminiTextResponse(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 })
}

// groupMode contrôle la réponse du resolver CBO ("groups") pour les scénarios qui en ont besoin
// (candidatePool ≥ 2 entités) : 'distinct' = chaque entité son propre groupe (jamais de fusion),
// 'merge' = un seul groupe SAME_OBJECT regroupant toutes les entités passées.
let groupMode: 'distinct' | 'merge' = 'distinct'
// signalMode contrôle la réponse du classificateur de signal ("evidence_text") :
// une valeur ObjectStateSignal pour un succès, 'FAIL' pour simuler une panne HTTP 500.
let signalMode: string = 'PROGRESS'

function stubGeminiFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const urlStr = String(url)
    if (!urlStr.includes('generativelanguage.googleapis.com')) return realFetch(url as never, init)

    const bodyStr = String(init?.body ?? '')

    if (bodyStr.includes('"groups"')) {
      const entities = parseGeminiEntities(init)
      const groups = groupMode === 'merge'
        ? [{ label: entities[0]?.label ?? 'groupe', members: entities.map((e) => e.entityId), decision: 'SAME_OBJECT', confidence: 0.9, reasoning: 'test' }]
        : entities.map((e) => ({ label: e.label, members: [e.entityId], decision: 'RELATED_BUT_DISTINCT', confidence: 0.5, reasoning: 'test' }))
      return geminiTextResponse(JSON.stringify({ groups }))
    }

    if (bodyStr.includes('evidence_text')) {
      if (signalMode === 'FAIL') return new Response('boom', { status: 500 })
      return geminiTextResponse(JSON.stringify({ signal: signalMode, confidence: 0.8, evidence_text: 'texte de test' }))
    }

    throw new Error(`stubGeminiFetch: corps de requête non reconnu: ${bodyStr.slice(0, 200)}`)
  }))
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

  const { data: siteRow } = await db.from('sites').select('tenant_id').eq('id', siteId).single()
  const { data: report, error: rErr } = await db
    .from('site_reports')
    .insert({ site_id: siteId, tenant_id: (siteRow as { tenant_id: string }).tenant_id })
    .select('id').single()
  if (rErr) throw rErr
  siteReportId = (report as { id: string }).id
})

afterAll(async () => {
  const db = createAdminClient()
  await db.from('object_state_occurrence_signal').delete().eq('site_id', siteId)
  await db.from('canonical_business_object_member').delete().in(
    'member_entity_id',
    (await db.from('site_actions').select('id').eq('site_id', siteId)).data?.map((r: { id: string }) => r.id) ?? [],
  )
  await db.from('canonical_business_object').delete().eq('site_id', siteId)
  await db.from('site_actions').delete().eq('site_id', siteId)
  await db.from('site_reserve').delete().eq('site_id', siteId)
  await db.from('site_deadlines').delete().eq('site_id', siteId)
  await db.from('canonical_subject').delete().eq('site_id', siteId)
  if (siteReportId) await db.from('site_reports').delete().eq('id', siteReportId)
  if (siteId) await db.from('sites').delete().eq('id', siteId)
  if (clientId) await db.from('clients').delete().eq('id', clientId)
})

beforeEach(() => {
  vi.stubEnv('GOOGLE_GENAI_API_KEY', 'gk-test-h2b3')
  vi.stubEnv('AI_MODEL_LIGHT', 'gemini-2.5-flash')
  groupMode = 'distinct'
  signalMode = 'PROGRESS'
  stubGeminiFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function seedCanonicalSubject(label: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('canonical_subject')
    .insert({ site_id: siteId, label, status: 'active' })
    .select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

async function readSignal(entityType: string, entityId: string) {
  const db = createAdminClient()
  const { data } = await db
    .from('object_state_occurrence_signal')
    .select('*')
    .eq('entity_type', entityType).eq('entity_id', entityId)
    .maybeSingle()
  return data as { status: string; final_signal: string | null; canonical_business_object_id: string | null; error_code: string | null } | null
}

async function readMembership(entityType: string, entityId: string) {
  const db = createAdminClient()
  const { data } = await db
    .from('canonical_business_object_member')
    .select('canonical_business_object_id')
    .eq('member_entity_type', entityType).eq('member_entity_id', entityId)
    .maybeSingle()
  return (data as { canonical_business_object_id: string } | null)?.canonical_business_object_id ?? null
}

describe('H2-B.3 — branchement live du signal d’occurrence après rattachement CBO', () => {
  it('action live → CBO → signal', async () => {
    const db = createAdminClient()
    const label = `${TAG} Reprise étanchéité terrasse A`
    await seedCanonicalSubject(label)

    const { data: action, error } = await db.from('site_actions').insert({ site_id: siteId, title: label }).select('id').single()
    if (error) throw error
    const entityId = (action as { id: string }).id

    signalMode = 'PROGRESS'
    await resolveSubjectAndAttachCanonicalBusinessObject({ siteId, entityType: 'site_action', entityId, label, date: null })

    const cboId = await readMembership('site_action', entityId)
    expect(cboId).not.toBeNull()

    const signal = await readSignal('site_action', entityId)
    expect(signal).toMatchObject({ status: 'resolved', final_signal: 'PROGRESS', canonical_business_object_id: cboId })
  })

  it('réserve live → CBO → signal', async () => {
    const db = createAdminClient()
    const label = `${TAG} Fissure mur pignon sud`
    await seedCanonicalSubject(label)

    const { data: reserve, error } = await db.from('site_reserve').insert({ site_id: siteId, label }).select('id').single()
    if (error) throw error
    const entityId = (reserve as { id: string }).id

    signalMode = 'STILL_OPEN'
    await resolveSubjectAndAttachCanonicalBusinessObject({ siteId, entityType: 'site_reserve', entityId, label, date: null })

    const cboId = await readMembership('site_reserve', entityId)
    expect(cboId).not.toBeNull()

    const signal = await readSignal('site_reserve', entityId)
    expect(signal).toMatchObject({ status: 'resolved', final_signal: 'STILL_OPEN', canonical_business_object_id: cboId })
  })

  it('échéance live → CBO → signal', async () => {
    const db = createAdminClient()
    const label = `${TAG} Transmission situation travaux juillet`
    await seedCanonicalSubject(label)

    const { data: deadline, error } = await db.from('site_deadlines').insert({ site_id: siteId, title: label }).select('id').single()
    if (error) throw error
    const entityId = (deadline as { id: string }).id

    signalMode = 'COMPLETED'
    await resolveSubjectAndAttachCanonicalBusinessObject({ siteId, entityType: 'site_deadline', entityId, label, date: null })

    const cboId = await readMembership('site_deadline', entityId)
    expect(cboId).not.toBeNull()

    const signal = await readSignal('site_deadline', entityId)
    expect(signal).toMatchObject({ status: 'resolved', final_signal: 'COMPLETED', canonical_business_object_id: cboId })
  })

  it('PV historique → matérialisation → CBO → signal', async () => {
    const db = createAdminClient()
    const label = `${TAG} Reprise réseau regard R4 (historique)`
    const subjectId = await seedCanonicalSubject(label)

    // Simule l'état déjà écrit par projectCanonicalSubjectSafely() avant l'appel de
    // attachHistoricalReportEntitiesToCanonicalBusinessObjects (cf. docblock de cette
    // fonction) : canonical_subject_id posé, report_id renseigné.
    const { data: action, error } = await db
      .from('site_actions')
      .insert({ site_id: siteId, title: label, report_id: siteReportId, canonical_subject_id: subjectId })
      .select('id').single()
    if (error) throw error
    const entityId = (action as { id: string }).id

    signalMode = 'OPENED'
    await attachHistoricalReportEntitiesToCanonicalBusinessObjects({ siteId, siteReportId })

    const cboId = await readMembership('site_action', entityId)
    expect(cboId).not.toBeNull()

    const signal = await readSignal('site_action', entityId)
    expect(signal).toMatchObject({ status: 'resolved', final_signal: 'OPENED', canonical_business_object_id: cboId })
  })

  it('panne LLM → objet et CBO conservés, signal unresolved', async () => {
    const db = createAdminClient()
    const label = `${TAG} Contrôle SSI niveau R+1`
    await seedCanonicalSubject(label)

    const { data: action, error } = await db.from('site_actions').insert({ site_id: siteId, title: label }).select('id').single()
    if (error) throw error
    const entityId = (action as { id: string }).id

    signalMode = 'FAIL'
    await resolveSubjectAndAttachCanonicalBusinessObject({ siteId, entityType: 'site_action', entityId, label, date: null })

    // L'objet source et le rattachement CBO ne sont jamais impactés par la panne LLM du signal.
    const { data: stillThere } = await db.from('site_actions').select('id').eq('id', entityId).maybeSingle()
    expect(stillThere).not.toBeNull()
    const cboId = await readMembership('site_action', entityId)
    expect(cboId).not.toBeNull()

    const signal = await readSignal('site_action', entityId)
    expect(signal).toMatchObject({ status: 'unresolved', final_signal: null, error_code: 'PROVIDER_ERROR', canonical_business_object_id: cboId })
  })

  it('replay → aucune duplication', async () => {
    const db = createAdminClient()
    const label = `${TAG} Nettoyage fin de chantier hall B`
    await seedCanonicalSubject(label)

    const { data: action, error } = await db.from('site_actions').insert({ site_id: siteId, title: label }).select('id').single()
    if (error) throw error
    const entityId = (action as { id: string }).id

    signalMode = 'COMPLETED'
    await resolveSubjectAndAttachCanonicalBusinessObject({ siteId, entityType: 'site_action', entityId, label, date: null })
    const cboIdAfterFirst = await readMembership('site_action', entityId)

    let signalCallCount = 0
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url)
      if (urlStr.includes('generativelanguage.googleapis.com') && String(init?.body ?? '').includes('evidence_text')) {
        signalCallCount += 1
      }
      return originalFetch(url as never, init)
    }))

    // Rejoue exactement le même appel (même chemin que les writers de production rejoués).
    await resolveSubjectAndAttachCanonicalBusinessObject({ siteId, entityType: 'site_action', entityId, label, date: null })

    expect(signalCallCount).toBe(0) // déjà resolved → skipped_already_resolved, aucun second appel LLM

    const { data: memberships } = await db
      .from('canonical_business_object_member')
      .select('id').eq('member_entity_type', 'site_action').eq('member_entity_id', entityId)
    expect(memberships).toHaveLength(1)

    const { data: signals } = await db
      .from('object_state_occurrence_signal')
      .select('id, canonical_business_object_id').eq('entity_type', 'site_action').eq('entity_id', entityId)
    expect(signals).toHaveLength(1)
    expect((signals as { canonical_business_object_id: string }[])[0].canonical_business_object_id).toBe(cboIdAfterFirst)
  })

  it('CBO déjà existant → signal rattaché au bon CBO', async () => {
    const db = createAdminClient()
    const label = `${TAG} Reprise peinture cage escalier`
    await seedCanonicalSubject(label)

    const { data: first, error: e1 } = await db.from('site_actions').insert({ site_id: siteId, title: label }).select('id').single()
    if (e1) throw e1
    const entityId1 = (first as { id: string }).id

    signalMode = 'OPENED'
    await resolveSubjectAndAttachCanonicalBusinessObject({ siteId, entityType: 'site_action', entityId: entityId1, label, date: null })
    const existingCboId = await readMembership('site_action', entityId1)
    expect(existingCboId).not.toBeNull()

    const { data: second, error: e2 } = await db.from('site_actions').insert({ site_id: siteId, title: `${label} (suite)` }).select('id').single()
    if (e2) throw e2
    const entityId2 = (second as { id: string }).id

    // ≥ 2 entités du même (sujet, type) → le resolver CBO ("groups") est appelé.
    // groupMode='merge' → SAME_OBJECT sur les deux → rattachement au CBO existant.
    groupMode = 'merge'
    signalMode = 'PROGRESS'
    await resolveSubjectAndAttachCanonicalBusinessObject({ siteId, entityType: 'site_action', entityId: entityId2, label: `${label} (suite)`, date: null })

    const cboId2 = await readMembership('site_action', entityId2)
    expect(cboId2).toBe(existingCboId)

    const signal2 = await readSignal('site_action', entityId2)
    expect(signal2).toMatchObject({ status: 'resolved', final_signal: 'PROGRESS', canonical_business_object_id: existingCboId })
  })

  it('aucun mélange entre deux CBO du même canonical_subject', async () => {
    const db = createAdminClient()
    const label = `${TAG} Regard R7 multi-problèmes`
    await seedCanonicalSubject(label)

    const { data: first, error: e1 } = await db.from('site_actions').insert({ site_id: siteId, title: `${label} — fuite` }).select('id').single()
    if (e1) throw e1
    const entityId1 = (first as { id: string }).id

    signalMode = 'OPENED'
    await resolveSubjectAndAttachCanonicalBusinessObject({ siteId, entityType: 'site_action', entityId: entityId1, label: `${label} — fuite`, date: null })
    const cboId1 = await readMembership('site_action', entityId1)
    expect(cboId1).not.toBeNull()

    const { data: second, error: e2 } = await db.from('site_actions').insert({ site_id: siteId, title: `${label} — signalétique manquante` }).select('id').single()
    if (e2) throw e2
    const entityId2 = (second as { id: string }).id

    // groupMode='distinct' (défaut) → le resolver refuse de fusionner : deux CBO solo distincts.
    groupMode = 'distinct'
    signalMode = 'COMPLETED'
    await resolveSubjectAndAttachCanonicalBusinessObject({ siteId, entityType: 'site_action', entityId: entityId2, label: `${label} — signalétique manquante`, date: null })
    const cboId2 = await readMembership('site_action', entityId2)
    expect(cboId2).not.toBeNull()

    expect(cboId2).not.toBe(cboId1)

    const signal1 = await readSignal('site_action', entityId1)
    const signal2 = await readSignal('site_action', entityId2)
    expect(signal1?.canonical_business_object_id).toBe(cboId1)
    expect(signal2?.canonical_business_object_id).toBe(cboId2)
    expect(signal1?.canonical_business_object_id).not.toBe(signal2?.canonical_business_object_id)
  })
})
