// Validation P0-Photo-B — readImageCaption (transcription vs génération)
//
// Rejoue VRD_002 (15 pages) et JAR_01 dans la sandbox de recette.
// Mesure : document_caption, visual_description, association_confidence par image.
//
// Critères PASS :
//   - 0 caption tronquée (finissant au milieu d'un mot, < 4 caractères)
//   - JAR_01 grille : ≥ 3/4 images avec association_confidence in ['high', 'medium']
//   - Pas de régression : image_count >= baseline de chaque cas
//
// Note : null est un résultat légitime pour document_caption (légende absente).
// Le critère n'est PAS "plus de captions = mieux".
//
// Usage : npx tsx scripts/_validate-p0-photo-b.ts
import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const SITE_ID = '23a66c4e-e758-412d-a613-d3626b2a10bc'
const ORG_ID = '95df55b5-11cf-4ace-b2ca-18b000ba9b25'
const TENANT_ID = '6411f392-6ed7-4aa1-82fc-e915dd398f7b'
const CREATED_BY = 'c16d2984-74d8-4f8b-9f8e-0efadc342f0d'
const STORAGE_BUCKET = 'documents'

const CASES = [
  {
    id: 'VRD_002',
    path: 'docs/corpus-pv/STRESS_TEST/VRD_GENIE_CIVIL/VRD_002_Compte_rendu_visite_chantier_GenieCivilPdf.pdf',
    filename: 'VRD_002_validate_p0_photo_b.pdf',
    totalPages: 15,
    baselineImages: 9,   // post-P0-Photo-A
    // Critères P0-Photo-B
    passCondition: '0 caption tronquée, pas de régression vs baseline 9',
  },
  {
    id: 'JAR_01',
    path: 'docs/corpus-pv/LONGITUDINAL/CHANTIER_004_JARNAC_RUE_PASTEUR/CR_01.pdf',
    filename: 'JAR_01_validate_p0_photo_b.pdf',
    totalPages: null,
    baselineImages: 8,   // stable depuis P0-Photo-A
    // Critères P0-Photo-B : grille 2×2 → association_confidence utile
    passCondition: '≥3/4 images avec association_confidence high|medium, 0 tronquée, pas de régression',
  },
]

function isTruncated(caption: string | null): boolean {
  if (!caption) return false
  if (caption.length < 4) return true
  // Se termine par un tiret, ellipse, ou milieu de mot (pas d'espace, ponctuation finale ou lettre normale)
  if (caption.endsWith('-') || caption.endsWith('…') || caption.endsWith('...')) return true
  return false
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { extractHistoricalPv } = await import('../lib/documents/extract-historical-pv')

  const { data: col } = await admin
    .from('document_collections')
    .select('id')
    .eq('scope_type', 'site')
    .eq('scope_id', SITE_ID)
    .is('deleted_at', null)
    .maybeSingle()
  if (!col) throw new Error('Collection sandbox introuvable')
  const collectionId = (col as { id: string }).id

  console.log(`\n=== Validation P0-Photo-B — readImageCaption (transcription documentaire) ===\n`)

  const allPass: boolean[] = []

  for (const cas of CASES) {
    console.log(`--- ${cas.id} ---`)
    console.log(`Baseline : ${cas.baselineImages} images`)
    console.log(`Critère PASS : ${cas.passCondition}`)

    const bytes = readFileSync(cas.path)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const storagePath = `historical-pv/${SITE_ID}/${randomUUID()}_${cas.filename}`

    const { error: upErr } = await admin.storage.from(STORAGE_BUCKET).upload(storagePath, bytes, {
      contentType: 'application/pdf', upsert: false,
    })
    if (upErr) { console.error(`  ERREUR upload : ${upErr.message}`); allPass.push(false); continue }

    const { data: docRow, error: docErr } = await admin
      .from('documents')
      .insert({
        organization_id: ORG_ID, tenant_id: TENANT_ID, collection_id: collectionId,
        document_type: 'historical_visit_report', storage_path: storagePath,
        filename: cas.filename, visibility_level: 'manager', tags: [],
        size_bytes: bytes.length, content_hash: hash,
        analysis_status: 'pending', created_by: CREATED_BY,
      })
      .select('id').single()
    if (docErr) { console.error(`  ERREUR doc : ${docErr.message}`); allPass.push(false); continue }
    const documentId = (docRow as { id: string }).id

    await admin.from('document_links').upsert(
      { document_id: documentId, target_type: 'site', target_id: SITE_ID, reference_label: null },
      { onConflict: 'document_id,target_type,target_id' },
    )

    console.log(`  Extraction en cours…`)
    const start = Date.now()
    try {
      await extractHistoricalPv(documentId, CREATED_BY, SITE_ID)
    } catch (e) {
      console.error(`  ERREUR extraction : ${e instanceof Error ? e.message : String(e)}`)
      allPass.push(false); continue
    }
    const durationMs = Date.now() - start

    const { data: runRow } = await admin
      .from('document_extraction_run')
      .select('id, status, error_message')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle()
    if (!runRow) { console.error('  Aucun run créé'); allPass.push(false); continue }
    const run = runRow as { id: string; status: string; error_message: string | null }

    const { data: evidence } = await admin
      .from('document_extraction_evidence')
      .select('evidence_type, source_page, caption, metadata')
      .eq('extraction_run_id', run.id)

    type EvidenceRow = {
      evidence_type: string
      source_page: number
      caption: string | null
      metadata: {
        nativeWidth?: number
        nativeHeight?: number
        bbox?: number[]
        visual_description?: string
        association_confidence?: 'high' | 'medium' | 'low'
      } | null
    }

    const images = ((evidence ?? []) as EvidenceRow[]).filter((e) => e.evidence_type === 'image')
    const imageCount = images.length
    const withCaption = images.filter((e) => e.caption !== null)
    const truncated = images.filter((e) => isTruncated(e.caption))
    const highMedConf = images.filter((e) =>
      e.metadata?.association_confidence === 'high' || e.metadata?.association_confidence === 'medium',
    )

    console.log(`\n  RÉSULTAT :`)
    console.log(`    status              = ${run.status}`)
    console.log(`    durée               = ${(durationMs / 1000).toFixed(1)}s`)
    console.log(`    images total        = ${imageCount} (baseline: ${cas.baselineImages})`)
    console.log(`    avec caption        = ${withCaption.length}/${imageCount}`)
    console.log(`    captions tronquées  = ${truncated.length}`)
    console.log(`    high|medium conf    = ${highMedConf.length}/${imageCount}`)

    console.log(`\n  DÉTAIL PAR IMAGE :`)
    for (const img of images.sort((a, b) => a.source_page - b.source_page)) {
      const conf = img.metadata?.association_confidence ?? '—'
      const desc = img.metadata?.visual_description ?? '—'
      console.log(`    p${img.source_page} | conf=${conf} | caption=${img.caption !== null ? JSON.stringify(img.caption) : 'null'} | desc=${desc}`)
    }

    // Verdict
    let casePass = true
    const failures: string[] = []

    if (imageCount < cas.baselineImages) {
      casePass = false
      failures.push(`Régression images : ${imageCount} < baseline ${cas.baselineImages}`)
    }
    if (truncated.length > 0) {
      casePass = false
      failures.push(`${truncated.length} caption(s) tronquée(s) : ${truncated.map((e) => JSON.stringify(e.caption)).join(', ')}`)
    }
    if (cas.id === 'JAR_01' && highMedConf.length < 3) {
      casePass = false
      failures.push(`Grille JAR_01 : ${highMedConf.length}/4 images avec conf high|medium (besoin ≥3)`)
    }

    console.log(`\n  VERDICT ${cas.id} : ${casePass ? '✅ PASS' : '❌ FAIL'}`)
    for (const f of failures) console.log(`  → ${f}`)
    console.log()
    allPass.push(casePass)
  }

  console.log(`\n=== VERDICT GLOBAL : ${allPass.every(Boolean) ? '✅ PASS — P0-Photo-B prêt pour commit' : '❌ FAIL — pas de commit'} ===\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
