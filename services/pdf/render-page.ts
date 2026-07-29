// Rendu d'une page PDF en PNG via mupdf (WASM, serverless-compatible).
// Fallback silencieux (null) si mupdf est indisponible ou si le rendu échoue.
// L'appelant enregistre alors une evidence page_snapshot avec storage_path=null.

export interface RenderPageResult {
  buffer: Buffer
  width: number
  height: number
}

export async function renderPdfPage(
  pdfBuffer: Buffer,
  pageIndex: number, // 0-based
  scale = 2.0,
): Promise<RenderPageResult | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mu = (await import('mupdf')) as any
    const data = new Uint8Array(pdfBuffer)
    const doc = mu.Document.openDocument(data, 'application/pdf')
    const page = doc.loadPage(pageIndex)
    const matrix = mu.Matrix.scale(scale, scale)
    const colorspace = mu.ColorSpace.DeviceRGB
    const pixmap = page.toPixmap(matrix, colorspace, false, true)
    const png: Uint8Array = pixmap.asPNG()
    const result: RenderPageResult = {
      buffer: Buffer.from(png),
      width: pixmap.getWidth() as number,
      height: pixmap.getHeight() as number,
    }
    pixmap.destroy()
    page.destroy()
    doc.destroy()
    return result
  } catch {
    return null
  }
}
