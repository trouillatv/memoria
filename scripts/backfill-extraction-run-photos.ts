// scripts/backfill-extraction-run-photos.ts
//
// Backfill idempotent des PHOTOS (evidence_type='image') d'un
// document_extraction_run DEJA matérialisé (site_reports existant), sans
// rejouer l'extraction LLM, sans nouveau run, sans retoucher aux
// propositions/Points/Actions/Sujets déjà matérialisés.
//
// Réutilise telles quelles les primitives de production :
//   - extractPageImages           (services/pdf/extract-images.ts)
//   - readImageCaption            (services/pdf/caption-image.ts)
//   - classifyImage               (lib/documents/extract-historical-pv.ts)
//   - shouldRetainAsVisitPhoto    (services/pdf/photo-filter.ts)
//   - insertExtractionEvidence / pinAllSnapshotsForRun / getPhotoMaterializationReport
//                                 (lib/db/document-extractions.ts)
//   - sync_run_photos_to_visit_capture (migration 420, RPC)
//
// Idempotence : les chemins de stockage snapshots/{documentId}/img-p{page}-{index}.png
// sont déterministes. Avant toute insertion, le script lit les storage_path déjà
// présents dans document_extraction_evidence pour ce run et ignore intégralement
// toute image dont le chemin existe déjà — aucune deuxième evidence n'est jamais
// créée pour la même image, même si le script est relancé plusieurs fois.
//
// Ce script ne touche jamais aux page_snapshot / propositions / LLM : scope
// strictement photo-only (evidence_type='image').
//
// Prérequis d'exécution : le garde-fou `import 'server-only'` (Next.js) jette
// hors contexte RSC. On neutralise ce garde-fou UNIQUEMENT pour ce process via
// un hook Module._resolveFilename (voir _stub-server-only-register.cjs) — le
// build applicatif réel n'est jamais concerné.
//
// Usage :
//   NODE_OPTIONS="-r ./_stub-server-only-register.cjs" npx tsx scripts/backfill-extraction-run-photos.ts --run-id=<uuid>
//     → dry-run (par défaut) : télécharge, extrait, légende, classe, décide de la
//       rétention, mais n'uploade rien et n'écrit rien en base.
//   NODE_OPTIONS="-r ./_stub-server-only-register.cjs" npx tsx scripts/backfill-extraction-run-photos.ts --run-id=<uuid> --apply
//     → écrit réellement (upload storage + evidence + pin + sync visit_capture).

import { existsSync, readFileSync } from 'node:fs'

function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvLocal()

const args = new Map<string, string | true>()
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  if (m) args.set(m[1], m[2] ?? true)
}
const RUN_ID = args.get('run-id')
const APPLY = args.get('apply') === true
if (typeof RUN_ID !== 'string' || RUN_ID.length === 0) {
  console.error('Usage: backfill-extraction-run-photos.ts --run-id=<uuid> [--apply]')
  process.exit(1)
}

// Doit rester cohérent avec MAX_IMAGE_DETECTION_PAGES dans
// lib/documents/extract-historical-pv.ts (même plafond pragmatique).
const MAX_IMAGE_DETECTION_PAGES = 50
const MAX_CAPTIONS = 20
const CAPTION_CONCURRENCY = 5

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { extractPdfText } = await import('@/services/pdf/extract')
  const { extractPageImages } = await import('@/services/pdf/extract-images')
  const { readImageCaption } = await import('@/services/pdf/caption-image')
  const { shouldRetainAsVisitPhoto } = await import('@/services/pdf/photo-filter')
  const { classifyImage } = await import('@/lib/documents/extract-historical-pv')
  const { insertExtractionEvidence, pinAllSnapshotsForRun, getPhotoMaterializationReport } =
    await import('@/lib/db/document-extractions')

  const admin = createAdminClient()

  console.log(`=== Backfill photos — run ${RUN_ID} — mode ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`)

  const { data: run, error: runErr } = await admin
    .from('document_extraction_run')
    .select('id, document_id, status, target_site_id')
    .eq('id', RUN_ID)
    .maybeSingle()
  if (runErr || !run) throw new Error(`run introuvable: ${runErr?.message ?? RUN_ID}`)
  const r = run as { id: string; document_id: string; status: string; target_site_id: string | null }

  const { data: siteReport } = await admin
    .from('site_reports')
    .select('id, site_id, organization_id')
    .eq('extraction_run_id', RUN_ID)
    .maybeSingle()
  if (!siteReport) {
    throw new Error('Aucun site_reports pour ce run — ce script suppose une visite déjà matérialisée (photo-only backfill).')
  }
  const sr = siteReport as { id: string; site_id: string; organization_id: string }
  console.log(`site_report=${sr.id} site_id=${sr.site_id} run_status=${r.status}`)

  const { data: doc, error: docErr } = await admin
    .from('documents')
    .select('id, storage_path, organization_id')
    .eq('id', r.document_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (docErr || !doc) throw new Error(`document introuvable: ${docErr?.message ?? r.document_id}`)
  const d = doc as { id: string; storage_path: string; organization_id: string }

  console.log('\n--- AVANT ---')
  const before = await getPhotoMaterializationReport(RUN_ID, sr.id)
  console.log(JSON.stringify(before, null, 2))

  // Identité stable existante — clé d'idempotence de premier niveau.
  const { data: existingEvidence } = await admin
    .from('document_extraction_evidence')
    .select('storage_path')
    .eq('extraction_run_id', RUN_ID)
    .eq('evidence_type', 'image')
  const existingPaths = new Set(
    ((existingEvidence ?? []) as Array<{ storage_path: string | null }>)
      .map((e) => e.storage_path)
      .filter((p): p is string => p !== null),
  )
  console.log(`\nstorage_path déjà présents (evidence_type='image') pour ce run : ${existingPaths.size}`)

  console.log('\n--- Téléchargement + extraction ---')
  const { data: blob, error: dlErr } = await admin.storage.from('documents').download(d.storage_path)
  if (dlErr || !blob) throw new Error(`download: ${dlErr?.message ?? 'no_blob'}`)
  const buffer = Buffer.from(await blob.arrayBuffer())

  const extracted = await extractPdfText(buffer)
  const pagesToDetect = Math.min(extracted.pageCount, MAX_IMAGE_DETECTION_PAGES)
  console.log(`pageCount=${extracted.pageCount} pagesToDetect=${pagesToDetect}`)

  type Candidate = {
    storagePath: string
    pageNum: number
    buffer: Buffer
    nativeWidth: number
    nativeHeight: number
    bbox: [number, number, number, number]
    normalizedBbox: [number, number, number, number]
    pageText: string
    geometryTier: string
    alreadyPresent: boolean
  }
  const candidates: Candidate[] = []
  let skippedAlreadyPresent = 0

  for (let pageNum = 1; pageNum <= pagesToDetect; pageNum++) {
    let pageResult: Awaited<ReturnType<typeof extractPageImages>> = { images: [], pageText: '', pageBounds: [0, 0, 0, 0] }
    try {
      pageResult = await extractPageImages(buffer, pageNum - 1)
    } catch {
      // page ignorée si extraction échoue
    }
    const pb = pageResult.pageBounds
    const pageW = pb[2] - pb[0]
    const pageH = pb[3] - pb[1]
    for (let i = 0; i < pageResult.images.length; i++) {
      const img = pageResult.images[i]
      const storagePath = `snapshots/${d.id}/img-p${pageNum}-${i + 1}.png`
      if (existingPaths.has(storagePath)) {
        skippedAlreadyPresent++
        continue
      }
      const normalizedBbox: [number, number, number, number] = pageW > 0 && pageH > 0
        ? [
            (img.bbox[0] - pb[0]) / pageW,
            (img.bbox[1] - pb[1]) / pageH,
            (img.bbox[2] - pb[0]) / pageW,
            (img.bbox[3] - pb[1]) / pageH,
          ]
        : [0, 0, 1, 1]
      candidates.push({
        storagePath,
        pageNum,
        buffer: img.buffer,
        nativeWidth: img.nativeWidth,
        nativeHeight: img.nativeHeight,
        bbox: img.bbox,
        normalizedBbox,
        pageText: pageResult.pageText,
        geometryTier: img.geometryTier,
        alreadyPresent: false,
      })
    }
  }
  console.log(`images natives détectées : ${candidates.length + skippedAlreadyPresent} (nouvelles=${candidates.length}, déjà backfillées=${skippedAlreadyPresent})`)

  // Légendage Vision, par lots (I/O bound), plafonné à MAX_CAPTIONS.
  const toCaption = candidates.slice(0, MAX_CAPTIONS)
  const captionMap = new Map<string, Awaited<ReturnType<typeof readImageCaption>>>()
  for (let b = 0; b < toCaption.length; b += CAPTION_CONCURRENCY) {
    const batch = toCaption.slice(b, b + CAPTION_CONCURRENCY)
    await Promise.all(
      batch.map(async (c) => {
        let result: Awaited<ReturnType<typeof readImageCaption>> = null
        try {
          // Photo-only : pas de re-rendu de snapshot de page (hors périmètre du backfill).
          result = await readImageCaption(c.buffer, null, c.normalizedBbox, c.pageNum, c.pageText)
        } catch { /* result reste null */ }
        captionMap.set(c.storagePath, result)
      }),
    )
  }
  console.log(`légendées : ${toCaption.length}/${candidates.length}`)

  const retained: Array<Candidate & { caption: string | null; imageClass: string; visualDescription: string | null; associationConfidence: string | null; documentCaptionRaw: string | null }> = []
  let droppedDecorative = 0
  let droppedAmbiguous = 0
  for (const c of candidates) {
    const cr = captionMap.get(c.storagePath) ?? null
    const { imageClass, bboxCoverage } = classifyImage(cr, c.normalizedBbox)
    if (!shouldRetainAsVisitPhoto({ geometryTier: c.geometryTier as never, imageClass, bboxCoverage })) {
      if (c.geometryTier === 'candidate') droppedAmbiguous++
      else droppedDecorative++
      continue
    }
    let caption = cr?.document_caption ?? null
    let documentCaptionRaw: string | null = null
    if (imageClass === 'document_context' && caption !== null) {
      documentCaptionRaw = caption
      caption = null
    }
    retained.push({
      ...c,
      caption,
      imageClass,
      visualDescription: cr?.visual_description ?? null,
      associationConfidence: cr?.association_confidence ?? null,
      documentCaptionRaw,
    })
  }
  console.log(`retenues=${retained.length} rejetées_décoratives=${droppedDecorative} rejetées_ambiguës=${droppedAmbiguous}`)
  for (const c of retained) {
    console.log(`  [p${c.pageNum}] ${c.storagePath} class=${c.imageClass} tier=${c.geometryTier} ${c.nativeWidth}x${c.nativeHeight}`)
  }

  if (!APPLY) {
    console.log('\n=== DRY-RUN — aucune écriture. Relancer avec --apply pour matérialiser. ===')
    return
  }

  if (retained.length > 0) {
    console.log('\n--- Upload storage (upsert) ---')
    for (const c of retained) {
      const { error: upErr } = await admin.storage
        .from('documents')
        .upload(c.storagePath, c.buffer, { contentType: 'image/png', upsert: true })
      if (upErr) throw new Error(`upload ${c.storagePath}: ${upErr.message}`)
    }

    console.log('--- Insertion document_extraction_evidence ---')
    const evidenceInputs = retained.map((c) => ({
      organization_id: d.organization_id,
      document_id: d.id,
      evidence_type: 'image' as const,
      source_page: c.pageNum,
      storage_path: c.storagePath,
      caption: c.caption,
      nearby_text: null,
      metadata: {
        nativeWidth: c.nativeWidth,
        nativeHeight: c.nativeHeight,
        bbox: c.bbox,
        image_class: c.imageClass,
        backfilled_by: 'scripts/backfill-extraction-run-photos.ts',
        ...(c.visualDescription ? { visual_description: c.visualDescription } : {}),
        ...(c.associationConfidence ? { association_confidence: c.associationConfidence } : {}),
        ...(c.documentCaptionRaw ? { document_caption_raw: c.documentCaptionRaw } : {}),
      },
    }))
    const inserted = await insertExtractionEvidence(RUN_ID, evidenceInputs)
    console.log(`evidence insérées : ${inserted.length}`)
  } else {
    console.log('\nAucune nouvelle photo à insérer (déjà backfillé ou rien de retenu).')
  }

  console.log('\n--- pinAllSnapshotsForRun ---')
  const pinResult = await pinAllSnapshotsForRun(RUN_ID)
  console.log(JSON.stringify(pinResult, null, 2))

  console.log('\n--- sync_run_photos_to_visit_capture (RPC, migration 420) ---')
  const { data: syncResult, error: syncErr } = await admin.rpc('sync_run_photos_to_visit_capture', { p_run_id: RUN_ID })
  if (syncErr) throw new Error(`sync RPC: ${syncErr.message}`)
  console.log(JSON.stringify(syncResult, null, 2))

  console.log('\n--- APRÈS ---')
  const after = await getPhotoMaterializationReport(RUN_ID, sr.id)
  console.log(JSON.stringify(after, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERREUR —', err)
    process.exit(1)
  })
