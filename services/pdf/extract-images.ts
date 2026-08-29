import 'server-only'
import { shouldKeepEmbeddedImage, MIN_NATIVE_PX } from './photo-filter'

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
  pageBounds: [number, number, number, number]  // mediabox PDF [x0, y0, x1, y1] en points
}

// Décision « garder / rejeter » externalisée dans `photo-filter.ts` (module pur,
// testable) : conservée si photographique par résolution native OU figure/scan
// couvrant substantiellement la page. Voir ce module pour la justification des seuils.

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

    sText.walk({
      onImageBlock(bbox: [number, number, number, number], _transform: unknown, image: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const img = image as any
        const w = img.getWidth() as number
        const h = img.getHeight() as number

        // Filtre : conservée si photographique par résolution native (ex. vignette
        // de planche photo, 640×850 px couvrant 3 % de la page) OU figure/scan
        // couvrant substantiellement la page. Rejette logos, bandeaux, icônes.
        const bboxArea = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
        if (!shouldKeepEmbeddedImage({ nativeWidth: w, nativeHeight: h, bboxArea, pageArea })) return

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

          images.push({
            pageIndex,
            imageIndex: imageIndex++,
            bbox,
            nativeWidth: w,
            nativeHeight: h,
            buffer: Buffer.from(png),
          })
        } catch {
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
              images.push({
                pageIndex,
                imageIndex: imageIndex++,
                bbox,
                nativeWidth: rx1 - rx0,
                nativeHeight: ry1 - ry0,
                buffer: Buffer.from(png),
              })
            }
          } catch {
            // Vraiment non récupérable — page ignorée
          }
        }
      },
    })

    sText.destroy()
    page.destroy()
    doc.destroy()
    return { images, pageText, pageBounds }
  } catch {
    return { images: [], pageText: '', pageBounds: [0, 0, 0, 0] }
  }
}
