/**
 * scripts/dev/raster-cr-becib.ts
 *
 * Rend le gabarit CR BECIB (fixture) PUIS le rasterise en PNG (1 par page) via
 * mupdf (WASM). Permet de REGARDER le rendu réel (pas grep-er les octets).
 *
 * Usage : npx tsx scripts/dev/raster-cr-becib.ts
 * Sortie : .preview/page-1.png, page-2.png, page-3.png
 */
import * as fs from 'fs'
import * as path from 'path'
import { renderToBuffer } from '@react-pdf/renderer'
import { CrBecibPdf } from '@/lib/pdf/cr-becib'
import { stampPageNumbers } from '@/lib/pdf/stamp-page-numbers'
import { CRAVACHE_FIXTURE } from '@/lib/documents/fixtures/cravache'

async function main() {
  const mupdf = await import('mupdf')
  const raw = await renderToBuffer(CrBecibPdf({ cr: CRAVACHE_FIXTURE }))
  const pdf = await stampPageNumbers(raw) // tampon « Page n / total »

  const dir = path.join(process.cwd(), '.preview')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir)

  const doc = mupdf.Document.openDocument(pdf, 'application/pdf')
  const n = doc.countPages()
  const scale = 150 / 72
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i)
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false)
    fs.writeFileSync(path.join(dir, `page-${i + 1}.png`), pix.asPNG())
    console.log(`✓ page-${i + 1}.png`)
  }
  console.log(`(${n} page(s) avec n° de page tamponné)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
