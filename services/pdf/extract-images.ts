import 'server-only'

// Extrait les objets image embarqués dans une page PDF via mupdf WASM.
// Approche native : pas de vision — on lit directement la structure PDF.
// Fallback silencieux (tableau vide) si mupdf est indisponible ou si la page
// ne contient aucun objet image.

export interface ExtractedImage {
  pageIndex: number   // 0-based
  imageIndex: number  // indice dans la page
  bbox: [number, number, number, number]  // coords PDF [x0, y0, x1, y1]
  nativeWidth: number   // pixels natifs
  nativeHeight: number
  buffer: Buffer      // PNG
}

export interface ExtractPageResult {
  images: ExtractedImage[]
  pageText: string   // texte de la page, context pour les légendes IA
}

// Filtre principal : surface de la bbox >= MIN_PAGE_COVERAGE de la surface de la page.
// Cela élimine les logos, bandeaux, icônes et cadres décoratifs (souvent < 5 % de la page)
// sans dépendre des dimensions natives (qui peuvent être trompeuses).
const MIN_PAGE_COVERAGE = 0.05  // 5 % de la page
// Garde-fou secondaire : évite les images anormalement petites en pixels natifs
const MIN_NATIVE_PX = 80

export async function extractPageImages(
  pdfBuffer: Buffer,
  pageIndex: number, // 0-based
): Promise<ExtractPageResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mu = (await import('mupdf')) as any
    const data = new Uint8Array(pdfBuffer)
    const doc = mu.Document.openDocument(data, 'application/pdf')
    const page = doc.loadPage(pageIndex)

    // Surface totale de la page (mediabox, en points PDF)
    const pageBounds = page.getBounds() as [number, number, number, number]
    const pageArea = (pageBounds[2] - pageBounds[0]) * (pageBounds[3] - pageBounds[1])

    // "preserve-images" demande à mupdf d'inclure les blocs image dans le stext
    const sText = page.toStructuredText('preserve-images')

    // Texte de la page pour le contexte des légendes IA
    const pageText: string = sText.asText?.() ?? ''

    const images: ExtractedImage[] = []
    let imageIndex = 0
    let blockCount = 0

    sText.walk({
      onImageBlock(bbox: [number, number, number, number], _transform: unknown, image: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const img = image as any
        const w = img.getWidth() as number
        const h = img.getHeight() as number
        const blockIdx = blockCount++
        const bboxArea = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
        const coverage = pageArea > 0 ? bboxArea / pageArea : 0

        // LOG DIAGNOSTIC — à supprimer après validation terrain
        console.error(JSON.stringify({
          service: 'extractPageImages',
          event: 'block_detected',
          pageIndex,
          blockIdx,
          bbox,
          nativeWidth: w,
          nativeHeight: h,
          coverage: Math.round(coverage * 1000) / 1000,
          pageArea: Math.round(pageArea),
          bboxArea: Math.round(bboxArea),
        }))

        // Filtre 1 : la bbox doit couvrir au moins MIN_PAGE_COVERAGE de la page
        // → élimine logos, bandeaux, cadres (logo BECIB = 2.4 %, photo = 19.9 %)
        if (pageArea > 0 && coverage < MIN_PAGE_COVERAGE) {
          console.error(JSON.stringify({ service: 'extractPageImages', event: 'block_filtered', pageIndex, blockIdx, reason: 'coverage_too_small', coverage }))
          return
        }

        // Filtre 2 : garde-fou sur les dimensions natives minimales
        if (w < MIN_NATIVE_PX || h < MIN_NATIVE_PX) {
          console.error(JSON.stringify({ service: 'extractPageImages', event: 'block_filtered', pageIndex, blockIdx, reason: 'native_too_small', w, h }))
          return
        }

        try {
          let pixmap = img.toPixmap()
          const n = pixmap.getNumberOfComponents() as number
          const alpha = pixmap.getAlpha() as number
          // Conversion CMYK → RGB (PNG ne supporte pas CMYK)
          if (n === 4 && !alpha) {
            const rgb = pixmap.convertToColorSpace(mu.ColorSpace.DeviceRGB)
            pixmap.destroy()
            pixmap = rgb
          }
          const png = pixmap.asPNG() as Uint8Array
          pixmap.destroy()

          console.error(JSON.stringify({ service: 'extractPageImages', event: 'block_accepted', pageIndex, blockIdx, via: 'toPixmap', imageIndex }))
          images.push({
            pageIndex,
            imageIndex: imageIndex++,
            bbox,
            nativeWidth: w,
            nativeHeight: h,
            buffer: Buffer.from(png),
          })
        } catch (toPixmapErr) {
          console.error(JSON.stringify({ service: 'extractPageImages', event: 'toPixmap_failed', pageIndex, blockIdx, error: toPixmapErr instanceof Error ? toPixmapErr.message : String(toPixmapErr) }))
          // L'objet image ne peut pas être décodé nativement (JPEG2000, JBIG2, CMYK non-standard…).
          // Fallback : rendre la région de la page correspondant à la bbox via DrawDevice.
          try {
            const scale = 2.0
            const rx0 = Math.floor(bbox[0] * scale)
            const ry0 = Math.floor(bbox[1] * scale)
            const rx1 = Math.ceil(bbox[2] * scale)
            const ry1 = Math.ceil(bbox[3] * scale)
            if (rx1 - rx0 > MIN_NATIVE_PX && ry1 - ry0 > MIN_NATIVE_PX) {
              const clipPx = new mu.Pixmap(mu.ColorSpace.DeviceRGB, [rx0, ry0, rx1, ry1], false)
              clipPx.clear(255)
              const device = new mu.DrawDevice(mu.Matrix.identity, clipPx)
              page.runPageContents(device, mu.Matrix.scale(scale, scale))
              device.close()
              const png = clipPx.asPNG() as Uint8Array
              clipPx.destroy()
              console.error(JSON.stringify({ service: 'extractPageImages', event: 'block_accepted', pageIndex, blockIdx, via: 'DrawDevice', imageIndex }))
              images.push({
                pageIndex,
                imageIndex: imageIndex++,
                bbox,
                nativeWidth: rx1 - rx0,
                nativeHeight: ry1 - ry0,
                buffer: Buffer.from(png),
              })
            } else {
              console.error(JSON.stringify({ service: 'extractPageImages', event: 'block_filtered', pageIndex, blockIdx, reason: 'DrawDevice_bbox_too_small', rx0, ry0, rx1, ry1 }))
            }
          } catch (drawErr) {
            console.error(JSON.stringify({ service: 'extractPageImages', event: 'block_filtered', pageIndex, blockIdx, reason: 'DrawDevice_failed', error: drawErr instanceof Error ? drawErr.message : String(drawErr) }))
          }
        }
      },
    })

    console.error(JSON.stringify({ service: 'extractPageImages', event: 'page_summary', pageIndex, blocksDetected: blockCount, imagesAccepted: images.length }))

    sText.destroy()
    page.destroy()
    doc.destroy()
    return { images, pageText }
  } catch {
    return { images: [], pageText: '' }
  }
}
