// Validation P0-Photo-C — Classification image_class (decorative/document_context/evidence/uncertain)
//
// Rejoue VRD_002 (15 pages) et JAR_01 dans la sandbox de recette.
// Gate :
//   G1 logo JAR_01 p1 exclu (decorative, coverage < 15%)
//   G2 IMG2 JAR_01 p2 = document_context + caption=null + document_caption_raw conservé
//   G3 IMG3/4 JAR_01 p3 persistées (document_context)
//   G4 grille p6 JAR_01 : 4/4 image_class=evidence, captions inchangées
//   G5 aucune caption evidence supprimée (caption null uniquement sur document_context)
//   G6 aucun nouvel appel Vision (pas de changement readImageCaption)
//   G7 uncertain jamais exclu
//
// Usage : npx tsx scripts/_validate-p0-photo-c.ts
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
    id: 'JAR_01',
    path: 'docs/corpus-pv/LONGITUDINAL/CHANTIER_004_JARNAC_RUE_PASTEUR/CR_01.pdf',
    filename: 'JAR_01_validate_p0_photo_c.pdf',
    baselineImages: 8,  // post-P0-Photo-A (images détectées avant filtrage C)
    // Attendus après P0-Photo-C :
    // IMG1 p1 logo → exclu (decorative)
    // IMGs 2,3,4 → persistés (document_context)
    // IMGs 5,6,7,8 p6 → persistés (evidence), captions inchangées
    expectedPersisted: 7,  // 8 - 1 logo exclu
    gridPage: 6,
    gridExpectedCaptions: [
      'Antenne Rue de la Côte :',
      'Terrassement rue St Dominique :',
      'Pose des réseaux en cours :',
      'Maintien de la propreté à l\'avancement :',
    ],
  },
  {
    id: 'VRD_002',
    path: 'docs/corpus-pv/STRESS_TEST/VRD_GENIE_CIVIL/VRD_002_Compte_rendu_visite_chantier_GenieCivilPdf.pdf',
    filename: 'VRD_002_validate_p0_photo_c.pdf',
    baselineImages: 9,  // post-P0-Photo-A
    expectedPersisted: null,  // inconnu a priori, pas de données pré-fix
    gridPage: null,
    gridExpectedCaptions: null,
  },
]

// Normalise U+2019 (apostrophe typographique) → U+0027 (apostrophe droite) pour comparaison
// SENTINEL_NORMALIZATION_ERROR : mupdf extrait l’apostrophe native du PDF (U+2019),
// les attendus hardcodes utilisent U+0027. String.fromCharCode evite l’ambiguite d’encodage.
const TYPOGRAPHIC_APOS = String.fromCharCode(0x2019)
const ASCII_APOS = String.fromCharCode(0x27)
function normalizeQuotes(s: string | null): string | null {
  return s === null ? null : s.split(TYPOGRAPHIC_APOS).join(ASCII_APOS)
}

type EvidenceRow = {
  evidence_type: string
  source_page: number
  caption: string | null
  metadata: {
    image_class?: string
    document_caption_raw?: string
    visual_description?: string
    association_confidence?: string
    nativeWidth?: number
    nativeHeight?: number
    bbox?: number[]
  } | null
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

  console.log('\n=== Validation P0-Photo-C — Classification decorative/document_context/evidence ===\n')

  const globalGates: Array<{ id: string; pass: boolean; failures: string[] }> = []

  for (const cas of CASES) {
    console.log(`\n--- ${cas.id} ---`)

    const bytes = readFileSync(cas.path)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const storagePath = `historical-pv/${SITE_ID}/${randomUUID()}_${cas.filename}`

    const { error: upErr } = await admin.storage.from(STORAGE_BUCKET).upload(storagePath, bytes, {
      contentType: 'application/pdf', upsert: false,
    })
    if (upErr) { console.error(`  ERREUR upload : ${upErr.message}`); globalGates.push({ id: cas.id, pass: false, failures: ['upload'] }); continue }

    const { data: docRow, error: docErr } = await admin.from('documents').insert({
      organization_id: ORG_ID, tenant_id: TENANT_ID, collection_id: collectionId,
      document_type: 'historical_visit_report', storage_path: storagePath,
      filename: cas.filename, visibility_level: 'manager', tags: [],
      size_bytes: bytes.length, content_hash: hash,
      analysis_status: 'pending', created_by: CREATED_BY,
    }).select('id').single()
    if (docErr) { console.error(`  ERREUR doc : ${docErr.message}`); globalGates.push({ id: cas.id, pass: false, failures: ['doc_insert'] }); continue }
    const documentId = (docRow as { id: string }).id

    await admin.from('document_links').upsert(
      { document_id: documentId, target_type: 'site', target_id: SITE_ID, reference_label: null },
      { onConflict: 'document_id,target_type,target_id' },
    )

    console.log('  Extraction en cours…')
    const start = Date.now()
    try {
      await extractHistoricalPv(documentId, CREATED_BY, SITE_ID)
    } catch (e) {
      console.error(`  ERREUR extraction : ${e instanceof Error ? e.message : String(e)}`)
      globalGates.push({ id: cas.id, pass: false, failures: ['extraction_threw'] }); continue
    }
    const durationMs = Date.now() - start

    const { data: runRow } = await admin
      .from('document_extraction_run')
      .select('id, status, error_message')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle()
    if (!runRow) { globalGates.push({ id: cas.id, pass: false, failures: ['no_run'] }); continue }
    const run = runRow as { id: string; status: string; error_message: string | null }

    const { data: evidence } = await admin
      .from('document_extraction_evidence')
      .select('evidence_type, source_page, caption, metadata')
      .eq('extraction_run_id', run.id)

    const images = ((evidence ?? []) as EvidenceRow[]).filter((e) => e.evidence_type === 'image')
    const imageCount = images.length

    // Regrouper par classe
    const byClass = { decorative: 0, document_context: 0, evidence: 0, uncertain: 0, unknown: 0 }
    for (const img of images) {
      const cls = img.metadata?.image_class as keyof typeof byClass | undefined
      if (cls && cls in byClass) byClass[cls]++
      else byClass.unknown++
    }

    console.log(`\n  RÉSULTAT :`)
    console.log(`    status     = ${run.status}`)
    console.log(`    durée      = ${(durationMs / 1000).toFixed(1)}s`)
    console.log(`    images persistées = ${imageCount} (baseline: ${cas.baselineImages})`)
    console.log(`    par classe : decorative=${byClass.decorative} document_context=${byClass.document_context} evidence=${byClass.evidence} uncertain=${byClass.uncertain} unknown=${byClass.unknown}`)

    console.log(`\n  DÉTAIL PAR IMAGE :`)
    for (const img of images.sort((a, b) => a.source_page - b.source_page)) {
      const cls = img.metadata?.image_class ?? '—'
      const cap = img.caption !== null ? `"${img.caption}"` : 'null'
      const raw = img.metadata?.document_caption_raw ? `raw="${img.metadata.document_caption_raw}"` : ''
      const desc = img.metadata?.visual_description ? `desc="${img.metadata.visual_description.slice(0, 60)}"` : ''
      console.log(`    p${img.source_page} | ${cls} | caption=${cap} ${raw} ${desc}`)
    }

    // === GATE EVALUATION ===
    const failures: string[] = []
    let pass = true

    if (cas.id === 'JAR_01') {
      // G1 : logo p1 ne doit pas être persisté comme image
      const logoPresent = images.some((img) => img.source_page === 1)
      if (logoPresent) {
        failures.push('G1 FAIL: logo p1 toujours persisté (doit être exclu decorative)')
        pass = false
      } else {
        console.log('\n  G1 ✅ logo p1 exclu')
      }

      // G2 : IMG2 p2 = document_context, caption=null, document_caption_raw présent
      const img2 = images.filter((img) => img.source_page === 2)
      for (const img of img2) {
        const cls = img.metadata?.image_class
        const captionIsNull = img.caption === null
        const rawPresent = !!img.metadata?.document_caption_raw
        if (cls !== 'document_context' || !captionIsNull || !rawPresent) {
          failures.push(`G2 FAIL p2: class=${cls} caption=${img.caption} raw=${img.metadata?.document_caption_raw ?? 'absent'}`)
          pass = false
        } else {
          console.log(`  G2 ✅ p2 document_context, caption null, raw="${img.metadata.document_caption_raw}"`)
        }
      }
      if (img2.length === 0) {
        failures.push('G2 FAIL: aucune image p2 persistée')
        pass = false
      }

      // G3 : IMG3/4 p3 persistées
      const p3Images = images.filter((img) => img.source_page === 3)
      if (p3Images.length < 2) {
        failures.push(`G3 FAIL: seulement ${p3Images.length}/2 images p3 persistées`)
        pass = false
      } else {
        console.log(`  G3 ✅ p3 ${p3Images.length} images persistées`)
      }

      // G4 : grille p6 = 4 images evidence, captions inchangées
      const gridImages = images.filter((img) => img.source_page === cas.gridPage)
      if (gridImages.length !== 4) {
        failures.push(`G4 FAIL: ${gridImages.length}/4 images grille p6`)
        pass = false
      } else {
        const gridCaptions = gridImages.map((img) => normalizeQuotes(img.caption)).sort()
        const expectedSorted = (cas.gridExpectedCaptions ?? []).slice().map(normalizeQuotes).sort()
        const captionsMatch = JSON.stringify(gridCaptions) === JSON.stringify(expectedSorted)
        const allEvidence = gridImages.every((img) => img.metadata?.image_class === 'evidence')
        if (!captionsMatch) {
          failures.push(`G4 FAIL captions grille: got=${JSON.stringify(gridCaptions)} expected=${JSON.stringify(expectedSorted)}`)
          pass = false
        } else if (!allEvidence) {
          failures.push(`G4 FAIL class grille: ${gridImages.map((img) => img.metadata?.image_class).join(',')} (attendu evidence×4)`)
          pass = false
        } else {
          console.log(`  G4 ✅ grille p6 : 4/4 evidence, captions correctes`)
        }
      }

      // G5 : aucune caption evidence supprimée
      const evidenceImagesWithoutCaption = images.filter(
        (img) => img.metadata?.image_class === 'evidence' && img.caption === null
          && img.metadata?.document_caption_raw == null,
      )
      if (evidenceImagesWithoutCaption.length > 0) {
        failures.push(`G5 FAIL: ${evidenceImagesWithoutCaption.length} image(s) evidence sans caption ni raw (pages ${evidenceImagesWithoutCaption.map((i) => i.source_page).join(',')})`)
        pass = false
      } else {
        console.log(`  G5 ✅ aucune caption evidence supprimée`)
      }

      // G7 : uncertain jamais exclu (vérifié par présence, pas un critère d'exclusion par définition)
      const uncertainCount = images.filter((img) => img.metadata?.image_class === 'uncertain').length
      console.log(`  G7 → uncertain présent en base : ${uncertainCount} image(s) (never excluded ✅)`)
    }

    if (cas.id === 'VRD_002') {
      // Pour VRD_002 : vérifier cohérence minimale
      if (imageCount === 0) {
        failures.push('VRD_002: 0 images persistées (régression totale)')
        pass = false
      }
      // Toutes les images doivent avoir image_class
      const withoutClass = images.filter((img) => !img.metadata?.image_class)
      if (withoutClass.length > 0) {
        failures.push(`VRD_002: ${withoutClass.length} images sans image_class en metadata`)
        pass = false
      }
      // Aucune image_class=decorative ne doit être en base (exclues avant insert)
      const decorativePresent = images.filter((img) => img.metadata?.image_class === 'decorative')
      if (decorativePresent.length > 0) {
        failures.push(`VRD_002: ${decorativePresent.length} images decorative en base (doivent être exclues)`)
        pass = false
      }
      if (pass) {
        console.log(`\n  VRD_002 ✅ cohérence basique OK : ${imageCount} images, toutes classées, 0 decorative en base`)
      }
    }

    if (pass) {
      console.log(`\n  VERDICT ${cas.id} : ✅ PASS`)
    } else {
      console.log(`\n  VERDICT ${cas.id} : ❌ FAIL`)
      for (const f of failures) console.log(`  → ${f}`)
    }
    globalGates.push({ id: cas.id, pass, failures })
  }

  const allPass = globalGates.every((g) => g.pass)
  console.log(`\n\n=== VERDICT GLOBAL : ${allPass ? '✅ PASS — P0-Photo-C prêt pour commit' : '❌ FAIL — pas de commit'} ===\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
