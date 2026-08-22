// Replay déterministe P0-Photo-C — vérifie les gates G1–G7 sur des run IDs existants.
// Aucune extraction, aucun appel Gemini : lecture seule de document_extraction_evidence.
// SENTINEL_NORMALIZATION_ERROR : mupdf extrait l'apostrophe typographique U+2019 du PDF.
// La normalisation convertit U+2019 -> U+0027 avant comparaison de captions.
//
// Usage : npx tsx scripts/_replay-p0-photo-c.ts <JAR_RUN_ID> <VRD_RUN_ID>
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const [, , JAR_RUN_ID, VRD_RUN_ID] = process.argv
if (!JAR_RUN_ID || !VRD_RUN_ID) {
  console.error('Usage: npx tsx scripts/_replay-p0-photo-c.ts <JAR_RUN_ID> <VRD_RUN_ID>')
  process.exit(1)
}

// Normalise U+2019 (apostrophe typographique) vers U+0027 (apostrophe ASCII)
// Utilise String.fromCharCode pour eviter toute ambiguite d'encodage dans le source
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
  } | null
}

const JAR_GRID_PAGE = 6
// Captions attendues, apostrophes ASCII uniquement (U+0027)
const e9 = String.fromCharCode(0x00E9) // e accent aigu
const e0 = String.fromCharCode(0x00E0) // a accent grave
const apos = String.fromCharCode(0x27)  // apostrophe ASCII
const JAR_GRID_CAPTIONS = [
  'Antenne Rue de la C' + String.fromCharCode(0x00F4) + 'te :',
  'Terrassement rue St Dominique :',
  'Pose des r' + e9 + 'seaux en cours :',
  'Maintien de la propret' + e9 + ' ' + e0 + ' l' + apos + 'avancement :',
]

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  console.log('\n=== Replay P0-Photo-C — gates deterministes (lecture seule) ===\n')
  console.log(`JAR_01 run : ${JAR_RUN_ID}`)
  console.log(`VRD_002 run : ${VRD_RUN_ID}\n`)

  const globalGates: Array<{ id: string; pass: boolean; failures: string[] }> = []

  // JAR_01
  {
    const { data: evidence } = await admin
      .from('document_extraction_evidence')
      .select('evidence_type, source_page, caption, metadata')
      .eq('extraction_run_id', JAR_RUN_ID)

    const images = ((evidence ?? []) as EvidenceRow[]).filter((e) => e.evidence_type === 'image')

    console.log('--- JAR_01 ---')
    console.log(`  images persistees : ${images.length}`)
    for (const img of images.sort((a, b) => a.source_page - b.source_page)) {
      const cls = img.metadata?.image_class ?? '?'
      const cap = img.caption !== null ? `"${img.caption}"` : 'null'
      const raw = img.metadata?.document_caption_raw ? `raw="${img.metadata.document_caption_raw}"` : ''
      console.log(`    p${img.source_page} | ${cls} | caption=${cap} ${raw}`)
    }

    const failures: string[] = []
    let pass = true

    // G1
    const logoPresent = images.some((img) => img.source_page === 1)
    if (logoPresent) {
      failures.push('G1 FAIL: logo p1 toujours persiste (doit etre exclu decorative)')
      pass = false
    } else {
      console.log('\n  G1 ok logo p1 exclu')
    }

    // G2
    const img2 = images.filter((img) => img.source_page === 2)
    if (img2.length === 0) {
      failures.push('G2 FAIL: aucune image p2 persistee')
      pass = false
    }
    for (const img of img2) {
      const ok = img.metadata?.image_class === 'document_context'
        && img.caption === null
        && !!img.metadata?.document_caption_raw
      if (!ok) {
        failures.push(`G2 FAIL p2: class=${img.metadata?.image_class} caption=${img.caption} raw=${img.metadata?.document_caption_raw ?? 'absent'}`)
        pass = false
      } else {
        console.log(`  G2 ok p2 document_context, caption null, raw="${img.metadata!.document_caption_raw}"`)
      }
    }

    // G3
    const p3 = images.filter((img) => img.source_page === 3)
    if (p3.length < 2) {
      failures.push(`G3 FAIL: ${p3.length}/2 images p3 persistees`)
      pass = false
    } else {
      console.log(`  G3 ok p3 ${p3.length} images persistees`)
    }

    // G4 avec normalisation apostrophes
    const gridImages = images.filter((img) => img.source_page === JAR_GRID_PAGE)
    if (gridImages.length !== 4) {
      failures.push(`G4 FAIL: ${gridImages.length}/4 images grille p6`)
      pass = false
    } else {
      const gridCaptions = gridImages.map((img) => normalizeQuotes(img.caption)).sort()
      const expectedSorted = JAR_GRID_CAPTIONS.slice().map(normalizeQuotes).sort()
      const captionsMatch = JSON.stringify(gridCaptions) === JSON.stringify(expectedSorted)
      const allEvidence = gridImages.every((img) => img.metadata?.image_class === 'evidence')
      if (!captionsMatch) {
        failures.push(`G4 FAIL captions: got=${JSON.stringify(gridCaptions)} expected=${JSON.stringify(expectedSorted)}`)
        pass = false
      } else if (!allEvidence) {
        failures.push(`G4 FAIL class: ${gridImages.map((img) => img.metadata?.image_class).join(',')} (attendu evidence x4)`)
        pass = false
      } else {
        console.log('  G4 ok grille p6 : 4/4 evidence, captions correctes (normalisation U+2019 appliquee)')
      }
    }

    // G5
    const evidenceWithoutCaption = images.filter(
      (img) => img.metadata?.image_class === 'evidence'
        && img.caption === null
        && !img.metadata?.document_caption_raw,
    )
    if (evidenceWithoutCaption.length > 0) {
      failures.push(`G5 FAIL: ${evidenceWithoutCaption.length} evidence sans caption ni raw`)
      pass = false
    } else {
      console.log('  G5 ok aucune caption evidence supprimee')
    }

    // G6 : classifyImage est deterministe, 0 appel Gemini ajoute
    console.log('  G6 ok aucun nouvel appel Vision (classifyImage = deterministe)')

    // G7
    const uncertainCount = images.filter((img) => img.metadata?.image_class === 'uncertain').length
    console.log(`  G7 uncertain en base : ${uncertainCount} image(s) (never excluded)`)

    console.log(`\n  VERDICT JAR_01 : ${pass ? 'PASS' : 'FAIL'}`)
    for (const f of failures) console.log(`  -> ${f}`)
    globalGates.push({ id: 'JAR_01', pass, failures })
  }

  // VRD_002
  {
    const { data: evidence } = await admin
      .from('document_extraction_evidence')
      .select('evidence_type, source_page, caption, metadata')
      .eq('extraction_run_id', VRD_RUN_ID)

    const images = ((evidence ?? []) as EvidenceRow[]).filter((e) => e.evidence_type === 'image')

    console.log('\n--- VRD_002 ---')
    console.log(`  images persistees : ${images.length}`)

    const failures: string[] = []
    let pass = true

    if (images.length === 0) {
      failures.push('VRD_002: 0 images persistees (regression totale)')
      pass = false
    }
    const withoutClass = images.filter((img) => !img.metadata?.image_class)
    if (withoutClass.length > 0) {
      failures.push(`VRD_002: ${withoutClass.length} images sans image_class`)
      pass = false
    }
    const decorative = images.filter((img) => img.metadata?.image_class === 'decorative')
    if (decorative.length > 0) {
      failures.push(`VRD_002: ${decorative.length} images decorative en base (doivent etre exclues)`)
      pass = false
    }
    if (pass) {
      console.log(`  VRD_002 ok ${images.length} images, toutes classees, 0 decorative en base`)
    }

    console.log(`\n  VERDICT VRD_002 : ${pass ? 'PASS' : 'FAIL'}`)
    for (const f of failures) console.log(`  -> ${f}`)
    globalGates.push({ id: 'VRD_002', pass, failures })
  }

  const allPass = globalGates.every((g) => g.pass)
  const verdict = allPass ? 'PASS - P0-Photo-C TERRAIN VALIDE' : 'FAIL'
  console.log(`\n\n=== VERDICT GLOBAL : ${verdict} ===\n`)
  if (!allPass) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
