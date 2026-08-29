/** Recette — applique le VRAI prédicat shouldKeepEmbeddedImage (photo-filter.ts)
 *  aux images natives du PDF BELLA, page par page. Aucune écriture. */
import * as fs from 'node:fs'
import { shouldKeepEmbeddedImage } from '../services/pdf/photo-filter'

const PDF = process.argv[2]
if (!PDF || !fs.existsSync(PDF)) { console.error('PDF introuvable:', PDF); process.exit(1) }

async function main() {
  const mu = (await import('mupdf')) as any
  const doc = mu.Document.openDocument(new Uint8Array(fs.readFileSync(PDF)), 'application/pdf')
  let totalKept = 0
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p)
    const b = page.getBounds()
    const pageArea = (b[2] - b[0]) * (b[3] - b[1])
    const st = page.toStructuredText('preserve-images')
    let count = 0, kept = 0
    st.walk({
      onImageBlock(bbox: number[], _t: unknown, image: any) {
        const w = image.getWidth(), h = image.getHeight()
        const bboxArea = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
        const keep = shouldKeepEmbeddedImage({ nativeWidth: w, nativeHeight: h, bboxArea, pageArea })
        count++; if (keep) { kept++; totalKept++ }
        console.log(`   p${p + 1} img#${count} native=${w}x${h}px cov=${((bboxArea / pageArea) * 100).toFixed(1)}% ${keep ? '✅ GARDÉE' : '✗ rejetée'}`)
      },
    })
    console.log(`Page ${p + 1} — ${count} bloc(s) image · ${kept} gardée(s)\n`)
    st.destroy(); page.destroy()
  }
  doc.destroy()
  console.log(`TOTAL images gardées = ${totalKept}`)
}

main()
