// Tamponne « Page n / total » en bas à droite de chaque page d'un PDF déjà
// rendu. POURQUOI : le prop `render` de @react-pdf (4.5.1 + React 19) ne dessine
// rien à l'écran (vérifié au raster) ; on injecte donc le numéro en
// post-traitement avec pdf-lib, ce qui est fiable et indépendant de cette API.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const MARINE = rgb(31 / 255, 42 / 255, 90 / 255) // #1F2A5A
const MARGIN = 34
const SIZE = 7.5

export async function stampPageNumbers(pdf: Buffer | Uint8Array): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf)
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  const pages = doc.getPages()
  const total = pages.length
  pages.forEach((page, i) => {
    const txt = `Page ${i + 1} / ${total}`
    const w = font.widthOfTextAtSize(txt, SIZE)
    // bas à droite, sur la ligne du fil d'Ariane (y=36 depuis le bas).
    page.drawText(txt, { x: page.getWidth() - MARGIN - w, y: 36, size: SIZE, font, color: MARINE })
  })
  return Buffer.from(await doc.save())
}
