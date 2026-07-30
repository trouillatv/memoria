// Test local de l'extraction native d'images PDF via mupdf.
// Usage : node scripts/test-photo-extraction.mjs <chemin/vers/fichier.pdf> [page (1-based, optionnel)]
// Les PNG extraits sont sauvegardés dans tmp/photo-extraction-test/

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename } from 'path'

const pdfPath = process.argv[2]
const pageFilter = process.argv[3] ? parseInt(process.argv[3], 10) : null

if (!pdfPath) {
  console.error('Usage: node scripts/test-photo-extraction.mjs <pdf> [page]')
  process.exit(1)
}

const MIN_NATIVE_PX = 80
const MIN_PAGE_COVERAGE = 0.05
const outDir = 'tmp/photo-extraction-test'
mkdirSync(outDir, { recursive: true })

const pdfBuffer = readFileSync(pdfPath)
const mu = await import('mupdf')
const data = new Uint8Array(pdfBuffer)
const doc = mu.Document.openDocument(data, 'application/pdf')
const pageCount = doc.countPages()

console.log(`PDF    : ${basename(pdfPath)}`)
console.log(`Pages  : ${pageCount}`)
console.log(`Output : ${outDir}/`)
if (pageFilter) console.log(`Filtre : page ${pageFilter} seulement`)
console.log()

let totalImages = 0

for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
  const pageNum = pageIndex + 1
  if (pageFilter && pageNum !== pageFilter) continue

  const page = doc.loadPage(pageIndex)
  const pageBounds = page.getBounds()
  const pageArea = (pageBounds[2] - pageBounds[0]) * (pageBounds[3] - pageBounds[1])
  const sText = page.toStructuredText('preserve-images')

  const found = []
  sText.walk({
    onImageBlock(bbox, _transform, image) {
      const w = image.getWidth()
      const h = image.getHeight()
      const bboxArea = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
      const coverage = pageArea > 0 ? bboxArea / pageArea : 1
      if (coverage < MIN_PAGE_COVERAGE) {
        console.log(`  page ${pageNum}: ignoré ${w}×${h}px (${(coverage*100).toFixed(1)}% page — logo/cadre)`)
        return
      }
      if (w < MIN_NATIVE_PX || h < MIN_NATIVE_PX) {
        console.log(`  page ${pageNum}: ignoré ${w}×${h}px (trop petit)`)
        return
      }
      try {
        let pixmap = image.toPixmap()
        const n = pixmap.getNumberOfComponents()
        const alpha = pixmap.getAlpha()
        if (n === 4 && !alpha) {
          const rgb = pixmap.convertToColorSpace(mu.ColorSpace.DeviceRGB)
          pixmap.destroy()
          pixmap = rgb
        }
        const png = pixmap.asPNG()
        pixmap.destroy()
        found.push({ bbox, w, h, png })
      } catch (e) {
        console.warn(`  page ${pageNum}: erreur décodage image`, e?.message ?? e)
      }
    },
  })

  sText.destroy()
  page.destroy()

  if (found.length > 0) {
    console.log(`Page ${pageNum}: ${found.length} image(s)`)
    for (let i = 0; i < found.length; i++) {
      const img = found[i]
      const name = `page-${String(pageNum).padStart(2, '0')}-img-${i + 1}.png`
      const outPath = join(outDir, name)
      writeFileSync(outPath, Buffer.from(img.png))
      const bboxRounded = img.bbox.map((v) => Math.round(v)).join(', ')
      const coverage = (((img.bbox[2]-img.bbox[0])*(img.bbox[3]-img.bbox[1]))/pageArea*100).toFixed(1)
      console.log(`  [${i + 1}] ${img.w}×${img.h}px  ${coverage}% page  bbox=[${bboxRounded}]  → ${name}`)
      totalImages++
    }
  }
}

doc.destroy()
console.log()
console.log(`Total : ${totalImages} image(s) sur ${pageFilter ? '1 page testée' : `${pageCount} pages`}`)
