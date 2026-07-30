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

// En dessous de ce seuil (pixels natifs), on ignore l'image :
// logos, icônes, puces et éléments décoratifs.
const MIN_NATIVE_PX = 80

export async function extractPageImages(
  pdfBuffer: Buffer,
  pageIndex: number, // 0-based
): Promise<ExtractedImage[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mu = (await import('mupdf')) as any
    const data = new Uint8Array(pdfBuffer)
    const doc = mu.Document.openDocument(data, 'application/pdf')
    const page = doc.loadPage(pageIndex)

    // "preserve-images" demande à mupdf d'inclure les blocs image dans le stext
    const sText = page.toStructuredText('preserve-images')

    const results: ExtractedImage[] = []
    let imageIndex = 0

    sText.walk({
      onImageBlock(bbox: [number, number, number, number], _transform: unknown, image: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const img = image as any
        const w = img.getWidth() as number
        const h = img.getHeight() as number
        if (w < MIN_NATIVE_PX || h < MIN_NATIVE_PX) return

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

          results.push({
            pageIndex,
            imageIndex: imageIndex++,
            bbox,
            nativeWidth: w,
            nativeHeight: h,
            buffer: Buffer.from(png),
          })
        } catch {
          // Ignore les images non décodables
        }
      },
    })

    sText.destroy()
    page.destroy()
    doc.destroy()
    return results
  } catch {
    return []
  }
}
