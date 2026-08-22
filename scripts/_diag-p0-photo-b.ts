// Diagnostic P0-Photo-B — JAR_01 uniquement, circuit court (sans extraction complète).
// Teste readImageCaption sur les 8 images de JAR_01 : extrait les images, rend les snapshots,
// appelle readImageCaption pour chaque, et expose le chemin précis de chaque retour.
//
// Nécessite CAPTION_DIAG=1 pour que les logs DIAG apparaissent.
// Usage : CAPTION_DIAG=1 npx tsx scripts/_diag-p0-photo-b.ts
import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'

const JAR_01_PATH = 'docs/corpus-pv/LONGITUDINAL/CHANTIER_004_JARNAC_RUE_PASTEUR/CR_01.pdf'
const TOTAL_PAGES = 6

async function main() {
  process.env.CAPTION_DIAG = '1'

  const buffer = readFileSync(JAR_01_PATH)
  const { renderPdfPage } = await import('../services/pdf/render-page')
  const { extractPageImages } = await import('../services/pdf/extract-images')
  const { readImageCaption } = await import('../services/pdf/caption-image')

  console.log('\n=== Diagnostic P0-Photo-B — JAR_01 (circuit court) ===\n')
  console.log(`PDF : ${JAR_01_PATH} (${buffer.length} bytes, ${TOTAL_PAGES} pages)\n`)

  // Rendu des snapshots page par page
  const snapshotBuffers = new Map<number, Buffer>()
  for (let pageNum = 1; pageNum <= TOTAL_PAGES; pageNum++) {
    const rendered = await renderPdfPage(buffer, pageNum - 1)
    if (rendered) {
      snapshotBuffers.set(pageNum, rendered.buffer)
      console.log(`Snapshot p${pageNum} : ${rendered.buffer.length} bytes`)
    } else {
      console.log(`Snapshot p${pageNum} : null`)
    }
  }
  console.log('')

  // Extraction et appel readImageCaption image par image
  let globalIdx = 0
  const rows: Array<{
    idx: number; pageNum: number; cropBytes: number; snapBytes: number | null;
    bbox: string; result: string
  }> = []

  for (let pageNum = 1; pageNum <= TOTAL_PAGES; pageNum++) {
    let pageResult
    try {
      pageResult = await extractPageImages(buffer, pageNum - 1)
    } catch (e) {
      console.error(`extractPageImages p${pageNum} ERREUR : ${e instanceof Error ? e.message : String(e)}`)
      continue
    }

    const pb = pageResult.pageBounds
    const pageW = pb[2] - pb[0]
    const pageH = pb[3] - pb[1]
    const snapshotBuffer = snapshotBuffers.get(pageNum) ?? null

    for (const img of pageResult.images) {
      globalIdx++
      const normalizedBbox: [number, number, number, number] = pageW > 0 && pageH > 0
        ? [
            (img.bbox[0] - pb[0]) / pageW,
            (img.bbox[1] - pb[1]) / pageH,
            (img.bbox[2] - pb[0]) / pageW,
            (img.bbox[3] - pb[1]) / pageH,
          ]
        : [0, 0, 1, 1]

      console.log(`\n[IMG ${globalIdx}] p${pageNum} | crop=${img.buffer.length}B | snap=${snapshotBuffer ? snapshotBuffer.length + 'B' : 'null'} | bbox=[${normalizedBbox.map((v) => v.toFixed(3)).join(',')}]`)
      console.log(`  pageText excerpt : ${pageResult.pageText.slice(0, 120).replace(/\n/g, ' ')}`)

      const before = Date.now()
      const result = await readImageCaption(img.buffer, snapshotBuffer, normalizedBbox, pageNum, pageResult.pageText)
      const ms = Date.now() - before

      const resultStr = result ? JSON.stringify(result) : 'null'
      console.log(`  → ${resultStr} (${ms}ms)`)

      rows.push({
        idx: globalIdx, pageNum,
        cropBytes: img.buffer.length,
        snapBytes: snapshotBuffer ? snapshotBuffer.length : null,
        bbox: `[${normalizedBbox.map((v) => v.toFixed(3)).join(',')}]`,
        result: resultStr,
      })
    }
  }

  // Tableau récap
  console.log('\n\n=== RÉCAP PAR IMAGE ===')
  console.log('idx | page | crop   | snap    | conf   | caption')
  console.log('----+------+--------+---------+--------+--------')
  for (const r of rows) {
    let parsed: { association_confidence?: string; document_caption?: string | null } | null = null
    try { parsed = r.result !== 'null' ? JSON.parse(r.result) : null } catch { /* */ }
    const conf = parsed?.association_confidence ?? '—'
    const cap = parsed?.document_caption !== undefined
      ? (parsed.document_caption !== null ? `"${parsed.document_caption}"` : 'null')
      : '—'
    console.log(`  ${r.idx}  |  p${r.pageNum}  | ${String(r.cropBytes).padStart(6)}B | ${r.snapBytes !== null ? String(r.snapBytes).padStart(7) + 'B' : '    null'} | ${conf.padEnd(6)} | ${cap}`)
  }

  const successCount = rows.filter((r) => r.result !== 'null').length
  console.log(`\n${successCount}/${rows.length} appels retournent un résultat structuré.`)
  console.log('\n=== Fin diagnostic ===\n')
}

main().catch((e) => { console.error(e); process.exit(1) })
