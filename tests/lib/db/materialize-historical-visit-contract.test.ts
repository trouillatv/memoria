// Test d'INTÉGRATION (vraie Supabase) — suite de contrat PERMANENTE pour la
// vraie fonction SQL materialize_historical_visit() (via rpc, pas un mock).
//
// Créée après l'incident de régression de la migration 429 : 429 a réécrit le
// corps entier de la fonction en repartant du texte historique de la migration
// 338 (au lieu de patcher la définition LIVE) et a silencieusement perdu trois
// contrats postérieurs à 338 qui n'existaient que dans la définition live :
//   - 374 : report_id sur la branche action.
//   - 368 : report_id/created_from/parsing ISO strict de due_date/statut
//     conditionnel sur les échéances.
//   - 367 : filtre pinned_for_visit sur la matérialisation photo.
// Aucun test réel ne l'a détecté : les seuls tests existants qui exerçaient
// cette fonction mockaient createAdminClient (tests/lib/document-extractions.test.ts,
// tests/lib/historical-visit-review.test.ts) — ils ne prouvent jamais le
// comportement SQL réel. Réparé par la migration 430
// (supabase/migrations/430_restore_materialize_historical_visit_regressed_contracts.sql).
//
// DOCTRINE PERMANENTE (mandat Vincent) : toute modification future de
// materialize_historical_visit() doit rester verte SIMULTANÉMENT sur les
// quatre familles d'invariants ci-dessous — report_id action (374), contrat
// complet des échéances (368), pinned_for_visit (367), promotion canonique +
// non-réappropriation sur rejeu idempotent (429) — pas seulement sur le
// nouveau comportement visé par cette modification.
//
// Conventions reprises de tests/lib/db/tracked-point-pending-resolution.test.ts
// (TAG, beforeAll/afterAll org→client→site→document→run, lookup admin user).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

const TAG = `__test_materialize_contract_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let adminUserId: string
let docId: string
let runAId: string
let runBId: string
let reportAId: string
let reportBId: string

const PINNED_STORAGE_PATH = `${TAG}/pinned.jpg`
const UNPINNED_STORAGE_PATH = `${TAG}/unpinned.jpg`

async function makeAcceptedProposal(runId: string, overrides: Record<string, unknown>) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('document_extraction_proposal')
    .insert({
      organization_id: orgId,
      extraction_run_id: runId,
      document_id: docId,
      review_status: 'accepted',
      ...overrides,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

async function makeEvidence(runId: string, overrides: Record<string, unknown>) {
  const db = createAdminClient()
  const { error } = await db.from('document_extraction_evidence').insert({
    organization_id: orgId,
    extraction_run_id: runId,
    document_id: docId,
    ...overrides,
  })
  if (error) throw error
}

async function materialize(runId: string, visitDate: string) {
  const db = createAdminClient()
  const { data, error } = await db.rpc('materialize_historical_visit', {
    p_run_id: runId,
    p_user_id: adminUserId,
    p_site_id: siteId,
    p_visit_date: visitDate,
    p_visit_title: `${TAG} visite`,
  })
  if (error) throw error
  return data as string
}

async function getRunCanonical(runId: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('document_extraction_run')
    .select('is_canonical')
    .eq('id', runId)
    .single()
  if (error) throw error
  return (data as unknown as { is_canonical: boolean }).is_canonical
}

beforeAll(async () => {
  const db = createAdminClient()

  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  const { data: admin } = await db.from('users').select('id').eq('role', 'admin').limit(1).maybeSingle()
  if (!admin) throw new Error('Aucun user admin — seed requis')
  adminUserId = (admin as { id: string }).id

  clientId = (await db.from('clients').insert({ name: `${TAG}client`, organization_id: orgId }).select('id').single()).data!.id as string
  siteId = (await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
  docId = (await db.from('documents').insert({ organization_id: orgId, document_type: 'historical_visit_report', storage_path: `${TAG}/pv.pdf`, filename: 'pv.pdf' }).select('id').single()).data!.id as string

  runAId = (await db.from('document_extraction_run').insert({ organization_id: orgId, document_id: docId, extractor_key: 'test' }).select('id').single()).data!.id as string
  runBId = (await db.from('document_extraction_run').insert({ organization_id: orgId, document_id: docId, extractor_key: 'test' }).select('id').single()).data!.id as string

  await makeAcceptedProposal(runAId, {
    proposal_family: 'action',
    label: `${TAG} action`,
    source_payload: { corps_etat: 'Plomberie', responsible_party: 'ACME' },
  })
  await makeAcceptedProposal(runAId, {
    proposal_family: 'deadline',
    label: `${TAG} deadline avec date`,
    source_payload: { dueDate: '2026-10-01' },
  })
  await makeAcceptedProposal(runAId, {
    proposal_family: 'deadline',
    label: `${TAG} deadline sans date`,
    source_payload: {},
  })
  await makeEvidence(runAId, {
    evidence_type: 'image',
    storage_path: PINNED_STORAGE_PATH,
    pinned_for_visit: true,
  })
  await makeEvidence(runAId, {
    evidence_type: 'image',
    storage_path: UNPINNED_STORAGE_PATH,
    pinned_for_visit: false,
  })

  reportAId = await materialize(runAId, '2026-09-01')
})

afterAll(async () => {
  const db = createAdminClient()

  const reportIds = [reportAId, reportBId].filter(Boolean)
  if (reportIds.length > 0) {
    await db.from('visit_capture').delete().in('report_id', reportIds)
    await db.from('site_report_attachments').delete().in('report_id', reportIds)
  }
  await db.from('site_actions').delete().eq('site_id', siteId)
  await db.from('site_deadlines').delete().eq('site_id', siteId)

  const { data: proposals } = await db
    .from('document_extraction_proposal')
    .select('id')
    .in('extraction_run_id', [runAId, runBId])
  const proposalIds = ((proposals ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (proposalIds.length > 0) {
    await db.from('document_proposal_materialization').delete().in('proposal_id', proposalIds)
  }
  await db.from('document_extraction_proposal').delete().in('extraction_run_id', [runAId, runBId])
  await db.from('document_extraction_evidence').delete().in('extraction_run_id', [runAId, runBId])
  await db.from('document_links').delete().eq('document_id', docId)

  if (reportIds.length > 0) {
    await db.from('site_reports').delete().in('id', reportIds)
  }
  await db.from('document_extraction_run').delete().in('id', [runAId, runBId])
  await db.from('documents').delete().eq('id', docId)
  await db.from('sites').delete().eq('id', siteId)
  await db.from('clients').delete().eq('id', clientId)
})

describe('materialize_historical_visit — contrat permanent (report_id, échéances, photos, promotion canonique)', () => {
  it('rattache le report_id à l’action matérialisée (contrat 374)', async () => {
    const db = createAdminClient()
    const { data, error } = await db
      .from('site_actions')
      .select('report_id')
      .eq('site_id', siteId)
      .eq('title', `${TAG} action`)
      .maybeSingle()
    if (error) throw error
    expect(data).not.toBeNull()
    expect((data as { report_id: string | null }).report_id).toBe(reportAId)
  })

  it('applique le contrat complet des échéances historiques (contrat 368)', async () => {
    const db = createAdminClient()

    const { data: withDate, error: errorWithDate } = await db
      .from('site_deadlines')
      .select('report_id, created_from, due_date, status')
      .eq('site_id', siteId)
      .eq('title', `${TAG} deadline avec date`)
      .single()
    if (errorWithDate) throw errorWithDate
    const deadlineWithDate = withDate as { report_id: string | null; created_from: string | null; due_date: string | null; status: string }
    expect(deadlineWithDate.report_id).toBe(reportAId)
    expect(deadlineWithDate.created_from).toBe('historical_import')
    expect(deadlineWithDate.due_date).toBe('2026-10-01')
    expect(deadlineWithDate.status).toBe('planned')

    const { data: withoutDate, error: errorWithoutDate } = await db
      .from('site_deadlines')
      .select('report_id, created_from, due_date, status')
      .eq('site_id', siteId)
      .eq('title', `${TAG} deadline sans date`)
      .single()
    if (errorWithoutDate) throw errorWithoutDate
    const deadlineWithoutDate = withoutDate as { report_id: string | null; created_from: string | null; due_date: string | null; status: string }
    // Aucune date n'a été fournie par le document : jamais de J+7 fabriqué, la
    // contrainte reste "à planifier" — c'est exactement ce que 429 avait cassé.
    expect(deadlineWithoutDate.report_id).toBe(reportAId)
    expect(deadlineWithoutDate.created_from).toBe('historical_import')
    expect(deadlineWithoutDate.due_date).toBeNull()
    expect(deadlineWithoutDate.status).toBe('to_plan')
  })

  it('matérialise uniquement la photo explicitement épinglée (contrat 367)', async () => {
    const db = createAdminClient()

    const { data: pinnedAttachment, error: pinnedError } = await db
      .from('site_report_attachments')
      .select('id')
      .eq('report_id', reportAId)
      .eq('storage_path', PINNED_STORAGE_PATH)
      .maybeSingle()
    if (pinnedError) throw pinnedError
    expect(pinnedAttachment).not.toBeNull()

    const { data: pinnedCapture, error: captureError } = await db
      .from('visit_capture')
      .select('id')
      .eq('attachment_id', (pinnedAttachment as { id: string }).id)
      .maybeSingle()
    if (captureError) throw captureError
    expect(pinnedCapture).not.toBeNull()

    const { data: unpinnedAttachment, error: unpinnedError } = await db
      .from('site_report_attachments')
      .select('id')
      .eq('report_id', reportAId)
      .eq('storage_path', UNPINNED_STORAGE_PATH)
      .maybeSingle()
    if (unpinnedError) throw unpinnedError
    expect(unpinnedAttachment).toBeNull()
  })

  it('promotion canonique atomique : A puis B, et un rejeu idempotent de A ne réclame jamais l’autorité (contrat 429)', async () => {
    // Première matérialisation : le run A (seul run du document) devient canonique.
    expect(await getRunCanonical(runAId)).toBe(true)

    // Le document est réanalysé (run B) puis finalisé par l'humain : l'autorité
    // se déplace atomiquement de A vers B.
    reportBId = await materialize(runBId, '2026-09-15')
    expect(await getRunCanonical(runAId)).toBe(false)
    expect(await getRunCanonical(runBId)).toBe(true)

    // Rejeu idempotent de A (ex. double-clic, retry réseau) : la visite existe déjà
    // pour ce run, la fonction retourne le même report_id sans jamais retraverser
    // le transfert is_canonical. B reste canonique.
    const replayReportId = await materialize(runAId, '2026-09-01')
    expect(replayReportId).toBe(reportAId)
    expect(await getRunCanonical(runAId)).toBe(false)
    expect(await getRunCanonical(runBId)).toBe(true)
  })
})
