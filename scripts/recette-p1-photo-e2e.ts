/**
 * Recette contrôlée du pipeline photo PV historique BELLA.
 *
 * Par défaut : audit strictement READ-ONLY.
 * Les modes d'écriture seront ajoutés explicitement après validation du baseline.
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { shouldKeepEmbeddedImage } from '../services/pdf/photo-filter'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRole) throw new Error('Configuration Supabase manquante')

const sb = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const BELLA_SITE_ID = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const BELLA_FILENAME = 'CR26-U103 - RUS BELLA NAPOLI 220726.pdf'
const MANIFEST_PATH = '.recette-p1-photo-e2e.json'

type Manifest = {
  recipeId: string
  createdAt: string
  sourceDocumentId: string
  sourceStoragePath: string
  testDocumentId: string
  testStoragePath: string
  runId: string | null
  reportId: string | null
  userId: string
}

async function loadManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Manifest
}

async function saveManifest(manifest: Manifest) {
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function managementQuery<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN manquant')
  const projectRef = new URL(url!).hostname.split('.')[0]
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!response.ok) throw new Error(`Management SQL ${response.status}: ${await response.text()}`)
  return response.json() as Promise<T[]>
}

async function queryOrThrow<T>(label: string, promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await promise
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

async function audit() {
  const functionRows = await managementQuery<{ def: string }>(
    `select pg_get_functiondef(p.oid) as def
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'materialize_historical_visit'`,
  )
  const functionDef = functionRows[0]?.def ?? ''
  const recipeDocuments = await queryOrThrow<any[]>('recipe residual documents', sb.from('documents')
    .select('id, filename, storage_path')
    .contains('tags', ['recette:p1-photo-e2e']))
  const { data: recipeStorage, error: recipeStorageError } = await sb.storage.from('documents').list('recette/p1-photo-e2e', { limit: 100 })
  if (recipeStorageError) throw new Error(`recipe storage residuals: ${recipeStorageError.message}`)
  const site = await queryOrThrow('site', sb.from('sites')
    .select('id, name, organization_id')
    .eq('id', BELLA_SITE_ID)
    .single())

  const links = await queryOrThrow('document_links', sb.from('document_links')
    .select('document_id, reference_label, documents!document_id(id, filename, storage_path, document_type, effective_date, created_at, deleted_at, content_hash, size_bytes)')
    .eq('target_type', 'site')
    .eq('target_id', BELLA_SITE_ID))

  const historicalDocuments = (links ?? [])
    .map((link: any) => ({ reference_label: link.reference_label, ...(Array.isArray(link.documents) ? link.documents[0] : link.documents) }))
    .filter((doc: any) => doc?.document_type === 'historical_visit_report')

  const documentIds = historicalDocuments.map((doc: any) => doc.id)
  const runs = documentIds.length === 0 ? [] : await queryOrThrow('runs', sb.from('document_extraction_run')
    .select('id, document_id, status, current_stage, target_site_id, is_canonical, created_at, completed_at, created_by')
    .in('document_id', documentIds)
    .order('created_at', { ascending: true }))

  const runIds = (runs as any[]).map((run) => run.id)
  const reports = runIds.length === 0 ? [] : await queryOrThrow('reports', sb.from('site_reports')
    .select('id, source_document_id, extraction_run_id, origin, started_at, created_at, text_input')
    .in('extraction_run_id', runIds)
    .order('created_at', { ascending: true }))

  const evidence = runIds.length === 0 ? [] : await queryOrThrow('evidence', sb.from('document_extraction_evidence')
    .select('id, document_id, extraction_run_id, evidence_type, source_page, storage_path, pinned_for_visit, metadata')
    .in('extraction_run_id', runIds))

  const reportIds = (reports as any[]).map((report) => report.id)
  const captures = reportIds.length === 0 ? [] : await queryOrThrow('captures', sb.from('visit_capture')
    .select('id, report_id, kind, source, attachment_id, created_at')
    .in('report_id', reportIds)
    .eq('kind', 'photo'))

  const evidenceByRun = new Map<string, { image: number; page_snapshot: number; pinned: number; pages: number[] }>()
  for (const item of evidence as any[]) {
    const current = evidenceByRun.get(item.extraction_run_id) ?? { image: 0, page_snapshot: 0, pinned: 0, pages: [] }
    if (item.evidence_type === 'image') current.image++
    if (item.evidence_type === 'page_snapshot') current.page_snapshot++
    if (item.pinned_for_visit) current.pinned++
    if (item.evidence_type === 'image' && typeof item.source_page === 'number') current.pages.push(item.source_page)
    evidenceByRun.set(item.extraction_run_id, current)
  }

  console.log(JSON.stringify({
    mode: 'audit-read-only',
    deployedMaterialization: {
      found: Boolean(functionDef),
      filtersPinnedForVisit: /dee\.pinned_for_visit\s*=\s*true/i.test(functionDef),
      visualEvidenceExcerpt: functionDef.match(/FROM public\.document_extraction_evidence dee[\s\S]{0,500}?ORDER BY dee\.storage_path[^;]*/i)?.[0] ?? null,
    },
    recipeResiduals: {
      documents: recipeDocuments,
      storageEntries: recipeStorage ?? [],
    },
    site,
    historicalDocuments,
    runs: (runs as any[]).map((run) => ({ ...run, evidence: evidenceByRun.get(run.id) ?? null })),
    reports,
    photoCaptures: captures,
  }, null, 2))
}

async function extract() {
  const existingManifest = await readFile(MANIFEST_PATH, 'utf8').catch(() => null)
  if (existingManifest) throw new Error(`${MANIFEST_PATH} existe déjà — nettoyer ou reprendre ce run avant d'en créer un autre`)

  const source = await queryOrThrow<any>('source document', sb.from('documents')
    .select('*')
    .eq('filename', BELLA_FILENAME)
    .eq('document_type', 'historical_visit_report')
    .is('deleted_at', null)
    .single())

  const { data: blob, error: downloadError } = await sb.storage.from('documents').download(source.storage_path)
  if (downloadError || !blob) throw new Error(`download source: ${downloadError?.message ?? 'blob absent'}`)
  const pdf = Buffer.from(await blob.arrayBuffer())
  const hash = createHash('sha256').update(pdf).digest('hex')
  if (source.content_hash && source.content_hash !== hash) {
    throw new Error(`Hash source incohérent: DB=${source.content_hash}, téléchargé=${hash}`)
  }

  const recipeId = randomUUID()
  const testDocumentId = randomUUID()
  const testStoragePath = `recette/p1-photo-e2e/${recipeId}/${BELLA_FILENAME}`
  const testFilename = `[RECETTE ${recipeId.slice(0, 8)}] ${BELLA_FILENAME}`

  const { error: uploadError } = await sb.storage.from('documents').upload(testStoragePath, pdf, {
    contentType: 'application/pdf',
    upsert: false,
  })
  if (uploadError) throw new Error(`upload clone: ${uploadError.message}`)

  const manifest: Manifest = {
    recipeId,
    createdAt: new Date().toISOString(),
    sourceDocumentId: source.id,
    sourceStoragePath: source.storage_path,
    testDocumentId,
    testStoragePath,
    runId: null,
    reportId: null,
    userId: source.created_by,
  }
  await saveManifest(manifest)

  const { error: documentError } = await sb.from('documents').insert({
    id: testDocumentId,
    organization_id: source.organization_id,
    tenant_id: source.tenant_id,
    collection_id: source.collection_id,
    filename: testFilename,
    storage_path: testStoragePath,
    size_bytes: pdf.length,
    content_hash: hash,
    document_type: 'historical_visit_report',
    effective_date: source.effective_date,
    status: source.status,
    analysis_status: 'pending',
    visibility_level: source.visibility_level,
    memory_tier: source.memory_tier,
    tags: [...(source.tags ?? []), 'recette:p1-photo-e2e', `recette:${recipeId}`],
    created_by: source.created_by,
  })
  if (documentError) throw new Error(`insert clone: ${documentError.message}`)

  const { error: linkError } = await sb.from('document_links').insert({
    document_id: testDocumentId,
    target_type: 'site',
    target_id: BELLA_SITE_ID,
    reference_label: `RECETTE P1 PHOTO ${recipeId}`,
  })
  if (linkError) throw new Error(`link clone: ${linkError.message}`)

  const { extractHistoricalPv } = await import('../lib/documents/extract-historical-pv')
  await extractHistoricalPv(testDocumentId, source.created_by, BELLA_SITE_ID)

  const run = await queryOrThrow<any>('test run', sb.from('document_extraction_run')
    .select('id, status, error_message')
    .eq('document_id', testDocumentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single())
  manifest.runId = run.id
  await saveManifest(manifest)
  if (run.status !== 'ready_for_review') throw new Error(`Extraction terminée avec status=${run.status}: ${run.error_message ?? ''}`)

  console.log(JSON.stringify({
    recipeId,
    sourceDocumentId: source.id,
    testDocumentId,
    runId: run.id,
    sourceBytes: pdf.length,
    sha256: hash,
    sourceUnchanged: true,
  }, null, 2))
}

async function verify() {
  const manifest = await loadManifest()
  if (!manifest.runId) throw new Error('Run de recette absent du manifeste')
  const evidence = await queryOrThrow<any[]>('test evidence', sb.from('document_extraction_evidence')
    .select('id, evidence_type, source_page, storage_path, pinned_for_visit, metadata, caption, nearby_text')
    .eq('extraction_run_id', manifest.runId)
    .order('source_page', { ascending: true }))
  const proposals = await queryOrThrow<any[]>('test proposals', sb.from('document_extraction_proposal')
    .select('id, proposal_family, review_status, source_page, source_payload')
    .eq('extraction_run_id', manifest.runId))
  const images = evidence.filter((item) => item.evidence_type === 'image')
  const snapshots = evidence.filter((item) => item.evidence_type === 'page_snapshot')
  const family = new Map<string, { strong: number; weak: number }>()
  for (const proposal of proposals) {
    const relevance = proposal.source_payload?.relevanceScore === 'weak' ? 'weak' : 'strong'
    const counts = family.get(proposal.proposal_family) ?? { strong: 0, weak: 0 }
    counts[relevance]++
    family.set(proposal.proposal_family, counts)
  }
  console.log(JSON.stringify({
    recipeId: manifest.recipeId,
    runId: manifest.runId,
    imageCount: images.length,
    snapshotCount: snapshots.length,
    snapshotPages: snapshots.map((item) => item.source_page),
    imagePages: images.map((item) => item.source_page),
    imageStoragePathsUnique: new Set(images.map((item) => item.storage_path)).size,
    imageProvenanceComplete: images.every((item) => item.source_page && item.storage_path && item.metadata),
    pinnedCount: evidence.filter((item) => item.pinned_for_visit).length,
    families: Object.fromEntries(family),
    uiContract: {
      heading: images.length > 0 ? 'Photos extraites' : 'Pages photographiques',
      selectableItems: images.length > 0 ? images.length : snapshots.length,
    },
    images: images.map((item) => ({ id: item.id, page: item.source_page, path: item.storage_path, metadata: item.metadata })),
  }, null, 2))
}

async function rawBlocks() {
  const source = await queryOrThrow<any>('source document', sb.from('documents')
    .select('storage_path')
    .eq('filename', BELLA_FILENAME)
    .eq('document_type', 'historical_visit_report')
    .is('deleted_at', null)
    .single())
  const { data: blob, error } = await sb.storage.from('documents').download(source.storage_path)
  if (error || !blob) throw new Error(`download source: ${error?.message ?? 'blob absent'}`)
  const mu = (await import('mupdf')) as any
  const document = mu.Document.openDocument(new Uint8Array(await blob.arrayBuffer()), 'application/pdf')
  const pages = []
  let raw = 0
  let kept = 0
  for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex++) {
    const page = document.loadPage(pageIndex)
    const bounds = page.getBounds()
    const pageArea = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
    const structured = page.toStructuredText('preserve-images')
    const blocks: Array<{ nativeWidth: number; nativeHeight: number; coverage: number; keep: boolean }> = []
    structured.walk({
      onImageBlock(bbox: number[], _transform: unknown, image: any) {
        const nativeWidth = image.getWidth() as number
        const nativeHeight = image.getHeight() as number
        const bboxArea = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
        const keep = shouldKeepEmbeddedImage({ nativeWidth, nativeHeight, bboxArea, pageArea })
        raw++
        if (keep) kept++
        blocks.push({ nativeWidth, nativeHeight, coverage: bboxArea / pageArea, keep })
      },
    })
    pages.push({ page: pageIndex + 1, raw: blocks.length, kept: blocks.filter((block) => block.keep).length, blocks })
    structured.destroy()
    page.destroy()
  }
  document.destroy()
  console.log(JSON.stringify({ rawBlocks: raw, kept, rejected: raw - kept, pages }, null, 2))
}

async function jarnac() {
  const pdf = await readFile('docs/corpus-pv/LONGITUDINAL/CHANTIER_004_JARNAC_RUE_PASTEUR/CR_01.pdf')
  const { extractPageImages } = await import('../services/pdf/extract-images')
  const pages = []
  let total = 0
  for (let pageIndex = 0; pageIndex < 12; pageIndex++) {
    const result = await extractPageImages(pdf, pageIndex)
    pages.push({ page: pageIndex + 1, images: result.images.length })
    total += result.images.length
  }
  console.log(JSON.stringify({ document: 'JARNAC CR_01', total, pages }, null, 2))
}

async function applyMigration() {
  const sql = await readFile('supabase/migrations/367_materialize_only_pinned_historical_photos.sql', 'utf8')
  await managementQuery(sql)
  const rows = await managementQuery<{ filtered: boolean }>(
    `select position('AND dee.pinned_for_visit = true' in pg_get_functiondef(p.oid)) > 0 as filtered
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'materialize_historical_visit'`,
  )
  if (!rows[0]?.filtered) throw new Error('La définition déployée ne filtre toujours pas pinned_for_visit')
  console.log(JSON.stringify({ migration: 367, applied: true, deployedFilterVerified: true }, null, 2))
}

async function selectTwo() {
  const manifest = await loadManifest()
  if (!manifest.runId) throw new Error('Run de recette absent du manifeste')
  const images = await queryOrThrow<any[]>('images', sb.from('document_extraction_evidence')
    .select('id, storage_path, source_page')
    .eq('extraction_run_id', manifest.runId)
    .eq('evidence_type', 'image')
    .order('storage_path', { ascending: true }))
  if (images.length !== 16) throw new Error(`Sélection refusée: ${images.length} images au lieu de 16`)

  const { error: clearError } = await sb.from('document_extraction_evidence')
    .update({ pinned_for_visit: false })
    .eq('extraction_run_id', manifest.runId)
    .in('evidence_type', ['image', 'page_snapshot'])
  if (clearError) throw new Error(`clear pins: ${clearError.message}`)

  const selected = [images[0], images[1]]
  const { error: pinError } = await sb.from('document_extraction_evidence')
    .update({ pinned_for_visit: true })
    .in('id', selected.map((image) => image.id))
  if (pinError) throw new Error(`pin two: ${pinError.message}`)

  const pinned = await queryOrThrow<any[]>('verify pins', sb.from('document_extraction_evidence')
    .select('id, evidence_type, source_page, storage_path')
    .eq('extraction_run_id', manifest.runId)
    .eq('pinned_for_visit', true))
  if (pinned.length !== 2 || pinned.some((item) => item.evidence_type !== 'image')) {
    throw new Error(`Invariant sélection rompu: ${JSON.stringify(pinned)}`)
  }
  console.log(JSON.stringify({ selectedCount: 2, selected: pinned }, null, 2))
}

async function materialize() {
  const manifest = await loadManifest()
  if (!manifest.runId) throw new Error('Run de recette absent du manifeste')
  const document = await queryOrThrow<any>('test document', sb.from('documents')
    .select('effective_date')
    .eq('id', manifest.testDocumentId)
    .single())
  if (!document.effective_date) throw new Error('Date effective absente')

  const call = () => sb.rpc('materialize_historical_visit', {
    p_run_id: manifest.runId,
    p_user_id: manifest.userId,
    p_site_id: BELLA_SITE_ID,
    p_visit_date: document.effective_date,
    p_visit_title: `[RECETTE P1 PHOTO ${manifest.recipeId}]`,
  })
  const first = await queryOrThrow<string>('materialize first', call())
  manifest.reportId = first
  await saveManifest(manifest)

  const readState = async () => {
    const captures = await queryOrThrow<any[]>('captures', sb.from('visit_capture')
      .select('id, report_id, kind, source, attachment_id, body')
      .eq('report_id', first)
      .eq('kind', 'photo'))
    const attachments = await queryOrThrow<any[]>('attachments', sb.from('site_report_attachments')
      .select('id, report_id, storage_path, filename')
      .eq('report_id', first)
      .eq('kind', 'photo'))
    return { captures, attachments }
  }

  const afterFirst = await readState()
  const second = await queryOrThrow<string>('materialize replay', call())
  const afterReplay = await readState()
  if (first !== second) throw new Error(`Idempotence report rompue: ${first} != ${second}`)
  if (afterFirst.captures.length !== 2 || afterReplay.captures.length !== 2) {
    throw new Error(`Idempotence captures rompue: ${afterFirst.captures.length} puis ${afterReplay.captures.length}`)
  }

  const pinned = await queryOrThrow<any[]>('pinned paths', sb.from('document_extraction_evidence')
    .select('storage_path')
    .eq('extraction_run_id', manifest.runId)
    .eq('pinned_for_visit', true))
  const pinnedPaths = new Set(pinned.map((item) => item.storage_path))
  if (afterReplay.attachments.some((item) => !pinnedPaths.has(item.storage_path))) {
    throw new Error('Une preuve non sélectionnée a été matérialisée')
  }

  console.log(JSON.stringify({
    reportId: first,
    firstMaterialization: { captures: afterFirst.captures.length, attachments: afterFirst.attachments.length },
    replay: { sameReport: first === second, captures: afterReplay.captures.length, attachments: afterReplay.attachments.length },
    onlyPinnedPathsMaterialized: true,
  }, null, 2))
}

async function counters() {
  const source = await queryOrThrow<any>('source document', sb.from('documents')
    .select('id')
    .eq('filename', BELLA_FILENAME)
    .eq('document_type', 'historical_visit_report')
    .is('deleted_at', null)
    .single())
  const runs = await queryOrThrow<any[]>('source runs', sb.from('document_extraction_run')
    .select('id, created_at, is_canonical')
    .eq('document_id', source.id)
    .order('created_at', { ascending: true }))
  const results = []
  for (const run of runs) {
    const proposals = await queryOrThrow<any[]>('source proposals', sb.from('document_extraction_proposal')
      .select('proposal_family, source_payload')
      .eq('extraction_run_id', run.id))
    const byFamily: Record<string, { visible: number; weak: number; total: number }> = {}
    for (const proposal of proposals) {
      const item = byFamily[proposal.proposal_family] ?? { visible: 0, weak: 0, total: 0 }
      const weak = proposal.source_payload?.relevanceScore === 'weak'
      item.total++
      if (weak) item.weak++
      else item.visible++
      byFamily[proposal.proposal_family] = item
    }
    results.push({ runId: run.id, createdAt: run.created_at, isCanonical: run.is_canonical, byFamily })
  }
  console.log(JSON.stringify({
    runs: results,
    expectedWitness: results.find((result) =>
      result.byFamily.knowledge_fact?.visible === 13 &&
      result.byFamily.knowledge_fact?.weak === 1 &&
      result.byFamily.company?.visible === 9 &&
      result.byFamily.company?.weak === 2),
  }, null, 2))
}

async function cleanup() {
  const manifest = await loadManifest()
  const runIds = await queryOrThrow<any[]>('recipe runs', sb.from('document_extraction_run')
    .select('id')
    .eq('document_id', manifest.testDocumentId))
  const ids = runIds.map((run) => run.id)
  const evidence = ids.length === 0 ? [] : await queryOrThrow<any[]>('recipe evidence', sb.from('document_extraction_evidence')
    .select('id, storage_path')
    .in('extraction_run_id', ids))
  const reports = ids.length === 0 ? [] : await queryOrThrow<any[]>('recipe reports', sb.from('site_reports')
    .select('id')
    .in('extraction_run_id', ids))
  const reportIds = reports.map((report) => report.id)
  const captures = reportIds.length === 0 ? [] : await queryOrThrow<any[]>('recipe captures', sb.from('visit_capture')
    .select('id')
    .in('report_id', reportIds))
  const attachments = reportIds.length === 0 ? [] : await queryOrThrow<any[]>('recipe attachments', sb.from('site_report_attachments')
    .select('id')
    .in('report_id', reportIds))

  if (reportIds.length > 0) {
    const { error: captureDeleteError } = await sb.from('visit_capture').delete().in('report_id', reportIds)
    if (captureDeleteError) throw new Error(`delete captures: ${captureDeleteError.message}`)
    const { error: attachmentDeleteError } = await sb.from('site_report_attachments').delete().in('report_id', reportIds)
    if (attachmentDeleteError) throw new Error(`delete attachments: ${attachmentDeleteError.message}`)
    const { error: reportLinkDeleteError } = await sb.from('document_links').delete().eq('target_type', 'site_report').in('target_id', reportIds)
    if (reportLinkDeleteError) throw new Error(`delete report links: ${reportLinkDeleteError.message}`)
    const { error: reportDeleteError } = await sb.from('site_reports').delete().in('id', reportIds)
    if (reportDeleteError) throw new Error(`delete reports: ${reportDeleteError.message}`)
  }

  const { error: docLinkDeleteError } = await sb.from('document_links').delete().eq('document_id', manifest.testDocumentId)
  if (docLinkDeleteError) throw new Error(`delete document links: ${docLinkDeleteError.message}`)
  const { error: documentDeleteError } = await sb.from('documents').delete().eq('id', manifest.testDocumentId)
  if (documentDeleteError) throw new Error(`delete document: ${documentDeleteError.message}`)

  const storagePaths = [...new Set([
    manifest.testStoragePath,
    ...evidence.map((item) => item.storage_path).filter(Boolean),
  ])]
  if (storagePaths.length > 0) {
    const { error: storageDeleteError } = await sb.storage.from('documents').remove(storagePaths)
    if (storageDeleteError) throw new Error(`delete storage: ${storageDeleteError.message}`)
  }

  const remainingDocument = await queryOrThrow<any[]>('remaining document', sb.from('documents').select('id').eq('id', manifest.testDocumentId))
  if (remainingDocument.length !== 0) throw new Error('Le document de recette existe encore après nettoyage')
  await unlink(MANIFEST_PATH)

  console.log(JSON.stringify({
    cleaned: {
      documents: 1,
      runs: runIds.length,
      evidence: evidence.length,
      reports: reports.length,
      captures: captures.length,
      attachments: attachments.length,
      storageObjects: storagePaths.length,
    },
    sourceDocumentUntouched: manifest.sourceDocumentId,
  }, null, 2))
}

const mode = process.argv[2] ?? 'audit'
const modes: Record<string, () => Promise<void>> = {
  audit,
  extract,
  verify,
  'raw-blocks': rawBlocks,
  jarnac,
  'apply-migration': applyMigration,
  'select-two': selectTwo,
  materialize,
  counters,
  cleanup,
}
if (!modes[mode]) throw new Error(`Mode non implémenté: ${mode}`)

modes[mode]().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
